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

import { each } from 'zrender/src/core/util';
import { addSafe } from './number';
import { StackInfo } from './types';

/**
 * Percent stackStrategy logic to normalize each value as a percentage of the total per index.
 */
export function calculatePercentStack(stackInfoList: StackInfo[]) {
    const dataLength = stackInfoList[0].data.count();

    // Check if any series in this stack group is using 'percent' stackStrategy.
    const isPercentStacked = stackInfoList.some((info) => info.seriesModel.get('stackStrategy') === 'percent');
    const totals = isPercentStacked ? accumulateTotals(stackInfoList, dataLength) : undefined;
    // Used to track running total of percent values at each index.
    const cumulativePercents = isPercentStacked ? Array(dataLength).fill(0) : undefined;

    each(stackInfoList, function (targetStackInfo) {
        const resultVal: number[] = [];
        const resultNaN = [NaN, NaN];
        const dims: [string, string] = [targetStackInfo.stackResultDimension, targetStackInfo.stackedOverDimension];
        const targetData = targetStackInfo.data;

        // Should not write on raw data, because stack series model list changes
        // depending on legend selection.
        targetData.modify(dims, function (v0, v1, dataIndex) {
            const sum = targetData.get(targetStackInfo.stackedDimension, dataIndex) as number;

            // Consider `connectNulls` of line area, if value is NaN, stackedOver
            // should also be NaN, to draw a appropriate belt area.
            if (isNaN(sum)) {
                return resultNaN;
            }

            const total = totals![dataIndex];
            const percent = total === 0 ? 0 : (sum / total) * 100;
            const stackedOver = cumulativePercents![dataIndex];
            cumulativePercents![dataIndex] = addSafe(stackedOver, percent);
            resultVal[0] = cumulativePercents![dataIndex];
            resultVal[1] = stackedOver;
            return resultVal;
        });
    });
}

/**
* Accumulates the total value across all series at each index.
*/
function accumulateTotals(stackInfoList: StackInfo[], dataLength: number): number[] {
  const totals = Array(dataLength).fill(0);
  each(stackInfoList, (stackInfo) => {
      const data = stackInfo.data;
      const dim = stackInfo.stackedDimension;
      for (let i = 0; i < dataLength; i++) {
          const val = data.get(dim, i) as number;
          if (!isNaN(val)) {
              totals[i] = addSafe(totals[i], val);
          }
      }
  });
  return totals;
}
