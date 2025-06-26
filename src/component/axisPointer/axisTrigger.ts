/*
* Licensed to the Apache Software Foundation (ASF) under one
* or more contributor license agreements.  See the NOTICE file
* distributed with this work for additional information
* regarding copyright ownership.  The ASF licenses this file
* to you under the Apache License, Version 2.0 (the
* "License"); you may not use this file except in compliance
* with the License.  You may obtain a copy of the License at
*
* http://www.apache.org/licenses/LICENSE-2.0
*
* Unless required by applicable law or agreed to in writing,
* software distributed under the License is distributed on an
* "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
* KIND, either express or implied.  See the License for the
* specific language governing permissions and limitations
* under the License.
*/

import {makeInner, ModelFinderObject} from '../../util/model';
import * as modelHelper from './modelHelper';
import findPointFromSeries from './findPointFromSeries';
import GlobalModel from '../../model/Global';
import ExtensionAPI from '../../core/ExtensionAPI';
import { Dictionary, Payload, CommonAxisPointerOption, HighlightPayload, DownplayPayload } from '../../util/types';
import AxisPointerModel, { AxisPointerOption } from './AxisPointerModel';
import { each, curry, bind, extend, Curry1 } from 'zrender/src/core/util';
import { ZRenderType } from 'zrender/src/zrender';

const inner = makeInner<{
    axisPointerLastHighlights: Dictionary<BatchItem>
}, ZRenderType>();

type AxisValue = CommonAxisPointerOption['value'];

interface DataIndex {
    seriesIndex: number
    dataIndex: number
    dataIndexInside: number
}

type BatchItem = DataIndex;

export interface DataByAxis {
    // TODO: TYPE Value type
    value: string | number
    axisIndex: number
    axisDim: string
    axisType: string
    axisId: string

    seriesDataIndices: DataIndex[]

    valueLabelOpt: {
        precision: AxisPointerOption['label']['precision']
        formatter: AxisPointerOption['label']['formatter']
    }
}
export interface DataByCoordSys {
    coordSysId: string
    coordSysIndex: number
    coordSysType: string
    coordSysMainType: string
    dataByAxis: DataByAxis[]
}
interface DataByCoordSysCollection {
    list: DataByCoordSys[]
    map: Dictionary<DataByCoordSys>
}

type CollectedCoordInfo = ReturnType<typeof modelHelper['collect']>;
type CollectedAxisInfo = CollectedCoordInfo['axesInfo'][string];

interface AxisTriggerPayload extends Payload {
    currTrigger?: 'click' | 'mousemove' | 'leave'
    /**
     * x and y, which are mandatory, specify a point to trigger axisPointer and tooltip.
     */
    x?: number
    /**
     * x and y, which are mandatory, specify a point to trigger axisPointer and tooltip.
     */
    y?: number
    /**
     * finder, optional, restrict target axes.
     */
    seriesIndex?: number
    dataIndex: number

    axesInfo?: {
        // 'x'|'y'|'angle'
        axisDim?: string
        axisIndex?: number
        value?: AxisValue
    }[]

    dispatchAction: ExtensionAPI['dispatchAction']
}

type ShowValueMap = Dictionary<{
    value: AxisValue
    payloadBatch: BatchItem[]
}>;

/**
 * Basic logic: check all axis, if they do not demand show/highlight,
 * then hide/downplay them.
 *
 * @return content of event obj for echarts.connect.
 */
export default function axisTrigger(
    payload: AxisTriggerPayload,
    ecModel: GlobalModel,
    api: ExtensionAPI
) {
    const currTrigger = payload.currTrigger;
    let point = [payload.x, payload.y];
    const finder = payload;
    const dispatchAction = payload.dispatchAction || bind(api.dispatchAction, api);
    const coordSysAxesInfo = (ecModel.getComponent('axisPointer') as AxisPointerModel)
        .coordSysAxesInfo as CollectedCoordInfo;

    // Pending
    // See #6121. But we are not able to reproduce it yet.
    if (!coordSysAxesInfo) {
        return;
    }

    if (illegalPoint(point)) {
        // Used in the default behavior of `connection`: use the sample seriesIndex
        // and dataIndex. And also used in the tooltipView trigger.
        point = findPointFromSeries({
            seriesIndex: finder.seriesIndex,
            // Do not use dataIndexInside from other ec instance.
            // FIXME: auto detect it?
            dataIndex: finder.dataIndex
        }, ecModel).point;
    }
    const isIllegalPoint = illegalPoint(point);

    // Axis and value can be specified when calling dispatchAction({type: 'updateAxisPointer'}).
    // Notice: In this case, it is difficult to get the `point` (which is necessary to show
    // tooltip, so if point is not given, we just use the point found by sample seriesIndex
    // and dataIndex.
    const inputAxesInfo = finder.axesInfo;

    const axesInfo = coordSysAxesInfo.axesInfo;
    const shouldHide = currTrigger === 'leave' || illegalPoint(point);
    const outputPayload = {} as AxisTriggerPayload;

    const showValueMap: ShowValueMap = {};
    const dataByCoordSys: DataByCoordSysCollection = {
        list: [],
        map: {}
    };
    const updaters = {
        showPointer: curry(showPointer, showValueMap),
        showTooltip: curry(showTooltip, dataByCoordSys)
    };

    // Process for triggered axes.
    each(coordSysAxesInfo.coordSysMap, function (coordSys, coordSysKey) {
        const coordSysContainsPoint = isIllegalPoint || coordSys.containPoint(point);

        each(coordSysAxesInfo.coordSysAxesInfo[coordSysKey], function (axisInfo, key) {
            const axis = axisInfo.axis;
            const inputAxisInfo = findInputAxisInfo(inputAxesInfo, axisInfo);

            if (!shouldHide && coordSysContainsPoint && (!inputAxesInfo || inputAxisInfo)) {
                let val = inputAxisInfo && inputAxisInfo.value;

                if (val == null && !isIllegalPoint) {
                    val = axis.pointToData(point);
                }
                
                val != null && processOnAxis(axisInfo, val, updaters, false, outputPayload);
            }
        });
    });

    // Process for linked axes.
    const linkTriggers: Dictionary<AxisValue> = {};
    each(axesInfo, function (tarAxisInfo, tarKey) {
        const linkGroup = tarAxisInfo.linkGroup;

        // If axis has been triggered in the previous stage, it should not be triggered by link.
        if (linkGroup && !showValueMap[tarKey]) {
            each(linkGroup.axesInfo, function (srcAxisInfo, srcKey) {
                const srcValItem = showValueMap[srcKey];
                // If srcValItem exist, source axis is triggered, so link to target axis.
                if (srcAxisInfo !== tarAxisInfo && srcValItem) {
                    let val = srcValItem.value;
                    linkGroup.mapper && (val = tarAxisInfo.axis.scale.parse(linkGroup.mapper(
                        val, makeMapperParam(srcAxisInfo), makeMapperParam(tarAxisInfo)
                    )));
                    linkTriggers[tarAxisInfo.key] = val;
                }
            });
        }
    });
    each(linkTriggers, function (val, tarKey) {
        processOnAxis(axesInfo[tarKey], val, updaters, true, outputPayload);
    });

    updateModelActually(showValueMap, axesInfo, outputPayload);
    dispatchTooltipActually(dataByCoordSys, point, payload, dispatchAction);
    dispatchHighDownActually(axesInfo, dispatchAction, api);

    return outputPayload;
}

function processOnAxis(
    axisInfo: CollectedAxisInfo,
    newValue: AxisValue,
    updaters: {
        showPointer: Curry1<typeof showPointer, ShowValueMap>
        showTooltip: Curry1<typeof showTooltip, DataByCoordSysCollection>
    },
    noSnap: boolean,
    outputFinder: ModelFinderObject
) {
    const axis = axisInfo.axis;
    const isLinkedAxis = !!axisInfo.linkGroup;
    const isAlwaysShow = axisInfo.axisPointerModel.get('alwaysShow'); // Get alwaysShow here

    // P0: If the axis scale is blank, it means the axis itself is not valid.
    if (axis.scale.isBlank()) {
        return;
    }

    // Determine if the `newValue` is within the *visual extent* of the axis.
    const axisExtent = axis.scale.getExtent();
    const extentMin = Math.min(axisExtent[0], axisExtent[1]);
    const extentMax = Math.max(axisExtent[0], axisExtent[1]);
    const valueNum = newValue as number;

    // If the newValue is outside the *visual* range of the axis, then we should not show the pointer on THIS axis.
    if ((axis.type === 'time' || axis.type === 'value') &&
        !(valueNum >= extentMin && valueNum <= extentMax)
    ) {
        return;
    }

    let payloadBatch: BatchItem[] = [];
    let snapToValue: AxisValue = newValue;

    if (axisInfo.involveSeries) {
        const payloadInfo = buildPayloadsBySeries(newValue, axisInfo);
        payloadBatch = payloadInfo.payloadBatch;
        snapToValue = payloadInfo.snapToValue;

        if (payloadBatch[0] && outputFinder.seriesIndex == null) {
            extend(outputFinder, payloadBatch[0]);
        }
    }

    // P2: Apply snapping if enabled.
    if (!noSnap && axisInfo.snap) {
        if (snapToValue != null && axis.containData(snapToValue)) {
            newValue = snapToValue;
        }
    }

    // P3: Crucial modification here for `alwaysShow` and linked axes.
    // If the axis is alwaysShow and linked, and `payloadBatch` is empty,
    // we need to provide a dummy payloadBatch to ensure the line is drawn.
    // This is a known hack for this specific ECharts bug (issue comment provided in original prompt).
    // This ensures `option.seriesDataIndices` is not empty, which might prevent the renderer
    // from drawing the line when there's no data.
    if (isAlwaysShow && isLinkedAxis && payloadBatch.length === 0 && axisInfo.involveSeries) {
        const seriesModel = axisInfo.seriesModels && axisInfo.seriesModels[0];
        if (seriesModel) {
            // Provide a dummy dataIndex. The actual values (-1) don't matter as they won't be used
            // for tooltip content (because showTooltip checks payloadBatch.length)
            // or for highlight (if triggerEmphasis is false, or if it is filtered out).
            // Its sole purpose is to make `option.seriesDataIndices` non-empty for the renderer.
            payloadBatch.push({
                seriesIndex: seriesModel.seriesIndex,
                dataIndex: -1, 
                dataIndexInside: -1
            });
        }
    }

    // Always call showPointer with the determined `newValue`.
    updaters.showPointer(axisInfo, newValue, payloadBatch);

    // Dispatch tooltip info.
    updaters.showTooltip(axisInfo, { payloadBatch: payloadBatch }, snapToValue);
}

function buildPayloadsBySeries(value: AxisValue, axisInfo: CollectedAxisInfo) {
    const axis = axisInfo.axis;
    const dim = axis.dim;
    let snapToValue = value;
    const payloadBatch: BatchItem[] = [];
    let minDist = Number.MAX_VALUE;
    let minDiff = -1;

    each(axisInfo.seriesModels, function (series, idx) {
        const dataDim = series.getData().mapDimensionsAll(dim);
        let seriesNestestValue;
        let dataIndices;

        if (series.getAxisTooltipData) {
            const result = series.getAxisTooltipData(dataDim, value, axis);
            dataIndices = result.dataIndices;
            seriesNestestValue = result.nestestValue;
        }
        else {
            dataIndices = series.getData().indicesOfNearest(
                dataDim[0],
                value as number,
                // Add a threshold to avoid find the wrong dataIndex
                // when data length is not same.
                // false,
                axis.type === 'category' ? 0.5 : null
            );
            if (!dataIndices.length) {
                return;
            }
            seriesNestestValue = series.getData().get(dataDim[0], dataIndices[0]);
        }

        if (seriesNestestValue == null || !isFinite(seriesNestestValue)) {
            return;
        }

        const diff = value as number - seriesNestestValue;
        const dist = Math.abs(diff);
        // Consider category case
        if (dist <= minDist) {
            if (dist < minDist || (diff >= 0 && minDiff < 0)) {
                minDist = dist;
                minDiff = diff;
                snapToValue = seriesNestestValue;
                payloadBatch.length = 0;
            }
            each(dataIndices, function (dataIndex) {
                payloadBatch.push({
                    seriesIndex: series.seriesIndex,
                    dataIndexInside: dataIndex,
                    dataIndex: series.getData().getRawIndex(dataIndex)
                });
            });
        }
    });

    return {
        payloadBatch: payloadBatch,
        snapToValue: snapToValue
    };
}

function showPointer(
    showValueMap: ShowValueMap,
    axisInfo: CollectedAxisInfo,
    value: AxisValue,
    payloadBatch?: BatchItem[]
) {
    showValueMap[axisInfo.key] = {
        value: value,
        payloadBatch: payloadBatch
    };
}

function showTooltip(
    dataByCoordSys: DataByCoordSysCollection,
    axisInfo: CollectedCoordInfo['axesInfo'][string],
    payloadInfo: { payloadBatch: BatchItem[] },
    value: AxisValue
) {
    const payloadBatch = payloadInfo.payloadBatch;
    const axis = axisInfo.axis;
    const axisModel = axis.model;
    const axisPointerModel = axisInfo.axisPointerModel;

    // If no data, do not create anything in dataByCoordSys,
    // whose length will be used to judge whether dispatch action.
    // IMPORTANT: Only return here if payloadBatch is *truly* empty (no actual data points found).
    // The dummy batch should NOT prevent the tooltip from being prepared with axis info.
    if (!axisInfo.triggerTooltip || payloadBatch.filter(item => item.dataIndex !== -1).length === 0) {
        // If triggerTooltip is false, or if after filtering dummies, no actual data points exist, then return.
        return;
    }

    const coordSysModel = axisInfo.coordSys.model;
    const coordSysKey = modelHelper.makeKey(coordSysModel);
    let coordSysItem = dataByCoordSys.map[coordSysKey];
    if (!coordSysItem) {
        coordSysItem = dataByCoordSys.map[coordSysKey] = {
            coordSysId: coordSysModel.id,
            coordSysIndex: coordSysModel.componentIndex,
            coordSysType: coordSysModel.type,
            coordSysMainType: coordSysModel.mainType,
            dataByAxis: []
        };
        dataByCoordSys.list.push(coordSysItem);
    }

    coordSysItem.dataByAxis.push({
        axisDim: axis.dim,
        axisIndex: axisModel.componentIndex,
        axisType: axisModel.type,
        axisId: axisModel.id,
        value: value as number,
        valueLabelOpt: {
            precision: axisPointerModel.get(['label', 'precision']),
            formatter: axisPointerModel.get(['label', 'formatter'])
        },
        // Filter out dummy data indices here before passing to tooltip.
        seriesDataIndices: payloadBatch.filter(item => item.dataIndex !== -1).slice() 
    });
}

function updateModelActually(
    showValueMap: ShowValueMap,
    axesInfo: Dictionary<CollectedAxisInfo>,
    outputPayload: AxisTriggerPayload
) {
    const outputAxesInfo: AxisTriggerPayload['axesInfo'] = outputPayload.axesInfo = [];
    each(axesInfo, function (axisInfo, key) {
        const option = axisInfo.axisPointerModel.option;
        const valItem = showValueMap[key];
        
        const isAlwaysShow = axisInfo.axisPointerModel.get('alwaysShow');

        if (valItem) { // Case 1: valItem (from processOnAxis) is present.
            if (!axisInfo.useHandle) {
                 option.status = 'show';
            }
            option.value = valItem.value;
            // Always set seriesDataIndices based on valItem.payloadBatch.
            // This now includes our dummy batch if applicable.
            option.seriesDataIndices = (valItem.payloadBatch || []).slice();
        }
        else { // Case 2: valItem is null (processOnAxis was skipped or showPointer wasn't called)
            if (isAlwaysShow) {
                // If it's alwaysShow, ensure status is 'show'.
                // Retain previous value and seriesDataIndices.
                if (!axisInfo.useHandle) {
                    option.status = 'show';
                }
                // option.value and option.seriesDataIndices should hold their last valid states.
                // No need to set them here, as they would have been set in a prior frame when valItem was present.
            } else {
                // Not alwaysShow, and no valItem means hide.
                !axisInfo.useHandle && (option.status = 'hide');
                option.value = null; // Clear value when hiding
                option.seriesDataIndices = []; // Clear indices when hiding
            }
        }

        // If status is 'show', add to output payload for connect.
        option.status === 'show' && outputAxesInfo.push({
            axisDim: axisInfo.axis.dim,
            axisIndex: axisInfo.axis.model.componentIndex,
            value: option.value
        });
    });
}

function dispatchTooltipActually(
    dataByCoordSys: DataByCoordSysCollection,
    point: number[],
    payload: AxisTriggerPayload,
    dispatchAction: ExtensionAPI['dispatchAction']
) {
    // If no dataByCoordSys.list.length, it means no axes or no tooltip-triggering data points found.
    // If you want the tooltip to show ONLY if there's actual series data, then keep the `!dataByCoordSys.list.length` check.
    // If you want the tooltip to show just axis info even with dummy data, then the filter in showTooltip takes care of it.
    if (illegalPoint(point) || !dataByCoordSys.list.length) {
         dispatchAction({type: 'hideTip'});
         return;
    }

    const sampleItem = ((dataByCoordSys.list[0].dataByAxis[0] || {}).seriesDataIndices || [])[0] || {} as DataIndex;

    dispatchAction({
        type: 'showTip',
        escapeConnect: true,
        x: point[0],
        y: point[1],
        tooltipOption: payload.tooltipOption,
        position: payload.position,
        // The dataIndex and seriesIndex here might be from a dummy value if only dummy batch existed.
        // The tooltip formatter should be robust to this.
        dataIndexInside: sampleItem.dataIndexInside,
        dataIndex: sampleItem.dataIndex,
        seriesIndex: sampleItem.seriesIndex,
        dataByCoordSys: dataByCoordSys.list
    });
}

function dispatchHighDownActually(
    axesInfo: Dictionary<CollectedAxisInfo>,
    dispatchAction: ExtensionAPI['dispatchAction'],
    api: ExtensionAPI
) {
    const zr = api.getZr();
    const highDownKey = 'axisPointerLastHighlights' as const;
    const lastHighlights = inner(zr)[highDownKey] || {};
    const newHighlights: Dictionary<BatchItem> = inner(zr)[highDownKey] = {};

    each(axesInfo, function (axisInfo, key) {
        const option = axisInfo.axisPointerModel.option;
        // Only highlight if status is 'show' AND it triggers emphasis.
        if (option.status === 'show' && axisInfo.triggerEmphasis) {
            each(option.seriesDataIndices, function (batchItem) {
                // Filter out the dummy data index (-1) here before processing for highlight/downplay.
                if (batchItem.dataIndex !== -1) {
                    const key = batchItem.seriesIndex + ' | ' + batchItem.dataIndex;
                    newHighlights[key] = batchItem;
                }
            });
        }
    });

    // Diff.
    const toHighlight: BatchItem[] = [];
    const toDownplay: BatchItem[] = [];
    each(lastHighlights, function (batchItem, key) {
        !newHighlights[key] && toDownplay.push(batchItem);
    });
    each(newHighlights, function (batchItem, key) {
        !lastHighlights[key] && toHighlight.push(batchItem);
    });

    toDownplay.length && api.dispatchAction({
        type: 'downplay',
        escapeConnect: true,
        // Not blur others when highlight in axisPointer.
        notBlur: true,
        batch: toDownplay
    } as DownplayPayload);
    toHighlight.length && api.dispatchAction({
        type: 'highlight',
        escapeConnect: true,
        // Not blur others when highlight in axisPointer.
        notBlur: true,
        batch: toHighlight
    } as HighlightPayload);
}

function findInputAxisInfo(
    inputAxesInfo: AxisTriggerPayload['axesInfo'],
    axisInfo: CollectedAxisInfo
) {
    for (let i = 0; i < (inputAxesInfo || []).length; i++) {
        const inputAxisInfo = inputAxesInfo[i];
        if (axisInfo.axis.dim === inputAxisInfo.axisDim
            && axisInfo.axis.model.componentIndex === inputAxisInfo.axisIndex
        ) {
            return inputAxisInfo;
        }
    }
}

function makeMapperParam(axisInfo: CollectedAxisInfo) {
    const axisModel = axisInfo.axis.model;
    const item = {} as {
        axisDim: string
        axisIndex: number
        axisId: string
        axisName: string
    };
    const dim = item.axisDim = axisInfo.axis.dim;
    item.axisIndex = (item as any)[dim + 'AxisIndex'] = axisModel.componentIndex;
    item.axisName = (item as any)[dim + 'AxisName'] = axisModel.name;
    item.axisId = (item as any)[dim + 'AxisId'] = axisModel.id;
    return item;
}

function illegalPoint(point?: number[]) {
    return !point || point[0] == null || isNaN(point[0]) || point[1] == null || isNaN(point[1]);
}