
/*
* Licensed to the Apache Software Foundation (ASF) under one
* or more contributor license agreements.  See the NOTICE file
* distributed with this work for additional information
* regarding copyright ownership.  The ASF licenses this file
* to you under the Apache License, Version 2.0 (the
* "License"); you may not use this file except in compliance
* with the License.  You may obtain a copy of the License at
*
*   http://www.apache.org/licenses/LICENSE-2.0
*
* Unless required by applicable law or agreed to in writing,
* software distributed under the License is distributed on an
* "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
* KIND, either express or implied.  See the License for the
* specific language governing permissions and limitations
* under the License.
*/

import { calculatePercentStack } from '@/src/util/stack';
import { StackInfo, SOURCE_FORMAT_ARRAY_ROWS } from '@/src/util/types';
import Model from '@/src/model/Model';
import SeriesModel from '@/src/model/Series';
import SeriesData from '@/src/data/SeriesData';
import { createSourceFromSeriesDataOption } from '@/src/data/Source';
import prepareSeriesDataSchema from '@/src/data/helper/createDimensions';
import SeriesDimensionDefine from '@/src/data/SeriesDimensionDefine';

function createMockSeriesDataFromSchema(dimensions: string[], rows: (number | null)[][]): SeriesData {
    const hostModel = new Model();
    const source = createSourceFromSeriesDataOption({
        sourceFormat: SOURCE_FORMAT_ARRAY_ROWS,
        dimensions,
        data: rows as unknown as any[],
    });
    const schema = prepareSeriesDataSchema(source, {
        coordDimensions: dimensions.map((name) => ({ name })),
    });
    const storeDimStart = schema.dimensions.length;
    schema.dimensions.push(new SeriesDimensionDefine({
        name: '__stack_result__',
        type: 'float',
        isCalculationCoord: true,
        storeDimIndex: storeDimStart
    }));
    schema.dimensions.push(new SeriesDimensionDefine({
        name: '__stacked_over__',
        type: 'float',
        isCalculationCoord: true,
        storeDimIndex: storeDimStart + 1
    }));
    const seriesData = new SeriesData(schema, hostModel);
    seriesData.initData(source);
    return seriesData;
}

function createMockStackInfo(name: string, values: number[][]): StackInfo {
    const data = createMockSeriesDataFromSchema(['x', 'y'], values);
    const yInfo = data.getDimensionInfo('y');
    if (yInfo) {
        yInfo.isCalculationCoord = true;
    }
    data.setCalculationInfo({
        stackedDimension: 'y',
        stackedByDimension: '__stack_by__',
        stackResultDimension: '__stack_result__',
        stackedOverDimension: '__stacked_over__',
        isStackedByIndex: true,
    });
    // data.getDimensionInfo('y').isCalculationCoord = true;
    // data.getDimensionInfo('__stack_result__').isCalculationCoord = true;
    // data.getDimensionInfo('__stacked_over__').isCalculationCoord = true;
    const seriesModel = {
        name,
        getData: () => data
    } as SeriesModel;
    return {
        data,
        seriesModel,
        stackedDimension: 'y',
        stackedByDimension: '__stack_by__',
        stackResultDimension: '__stack_result__',
        stackedOverDimension: '__stacked_over__',
        isStackedByIndex: true,
    };
}

describe('util/stack', function () {
    describe('calculatePercentStack', function () {
        it('should calculate percent stack', function () {
            const stackInfoList: StackInfo[] = [
                createMockStackInfo('a', [
                [0, 10],
                [1, 20],
                [2, 30],
                ]),
                createMockStackInfo('b', [
                [0, 40],
                [1, 20],
                [2, 10],
                ]),
            ];

            calculatePercentStack(stackInfoList);
            const firstSeriesData = stackInfoList[0].data;
            // const stackResultDim = firstSeriesData.getCalculationInfo('stackResultDimension');
            // const stackedDimIdx = stackResultDim && firstSeriesData.getDimensionIndex(stackResultDim);
            const stackedOverDim = firstSeriesData.getCalculationInfo('stackedOverDimension');
            const stackedOverDimIdx = stackedOverDim && firstSeriesData.getDimensionIndex(stackedOverDim);
            const firstSeriesDataStore = firstSeriesData.getStore();
            // console.log('FINAL -> firstSeriesDataStore: ', firstSeriesDataStore);
            const dataIndex = 1;
            const stackStartValue = firstSeriesDataStore.get(stackedOverDimIdx, dataIndex);
            console.log('FINAL -> stackStartValue: ', stackStartValue);
            // console.log('FINAL -> stackInfoList: ', stackInfoList);
            // console.log(stackInfoList[0].data);
            // console.log(stackInfoList[0].data.getValues(0));
            // console.log(stackInfoList[0].data.getCalculationInfo('stackResultDimension')); // __stack_result__
            // const getValues = (info: StackInfo) => info.data.mapArray(['__stack_result__'], (val: number[]) => val[0]);
            // expect(getValues(stackInfoList[0])).toEqual([
            //     10 / (10 + 40),
            //     20 / (20 + 20),
            //     30 / (30 + 10),
            // ]);
        });
    });
});