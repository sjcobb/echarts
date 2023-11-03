// https://echarts.apache.org/examples/en/editor.html?c=line-simple

const option = {
    title: {
        text: "4000 series",
        left: "center",
    },
    xAxis: {
        type: "category",
        data: ["1", "2", "3", "4", "5", "6"],
        name: "Chart number",
        nameLocation: "middle",
        nameGap: 40,
        axisLabel: {
            interval: 0,
        },
        axisTick: {
            show: false,
        },
    },
    yAxis: {
        type: "value",
        name: "Render time (ms)",
        nameRotate: 90,
        nameLocation: "middle",
        nameGap: 50,
    },
    series: [
        {
            type: "line",
            data: [1.75, 4.7, 5.683, 8.0, 10.0, 12.0],
        },
    ],
};
// ## Perf Tests

// http://127.0.0.1:8080/test/largeLine.html

// ## Zoomed, With legend, 10000 points

// 1: 26ms
// 10: 28ms
// 20: 37ms
// 50: 58ms
// 100: 89ms
// 500: 301ms
// 1000: 550ms
// 2000: 1446ms
// 3000: 1808ms
// 4000: 1990ms

// ## Zoomed, Without legend, 10000 points

// 1: 26
// 10: 26
// 20: 33
// 50: 48
// 100: 84
// 500: 240
// 1000: 465
// 2000: 813
// 3000: 1150
// 4000: 1630

// ## LTTB, Zoomed, Without legend, 10000 points

// 500: 369

// ## Zoomed, Without legend, 400000 points

// 100: 1119
// 100: 1054

// ## Unzoomed, Without legend, 400000 points

// 100: 1363
// 200: 3056
// 300: 4003
// 500: 7105
// 500: 3095
// 1000: ERR Array buffer allocation failed

// ## LTTB, Unzoomed, Without legend, 400000 points

// 200: 1322
// 300: 2072
// 400: 3501
// 450: ERR Array buffer allocation failed at DataStore2.lttbDownSample, SeriesData2
// 500: 3095
// 600: 3095
// 900: ERR Array buffer allocation failed
// 1000: ERR Array buffer allocation failed

// ## LTTB, Unzoomed, Without legend, 50000 points

// 1000: 938

// ## NO LTTB, Unzoomed, Without legend, 50000 points

// 1000: 1603

// ## One Chart - 9000 points - Unoptimized

// 4000: 1670
// 4000: 1620
// 4000: 1583
// 4000: 3401

// ## Two Charts - 9000 points - Unoptimized

// 2000: 2040
// 2000: 2467
// 4000: 4526
// 4000: 4959
// 4000: 6181
// 4000: 5942

// ## Three Charts - 9000 points - Unoptimized

// 4000: 5683
// 4000: 5661
// 4000: 9282

// ## Four Charts - 9000 points - Unoptimized

// 2000: 5214
// 2000: 3528
// 4000: 7293
// 4000: 7590
// 4000: 7662
// 4000: 11061
// 4000: 11903

// ## Four Charts - 9000 points - Optimized

// 4000: 7942
// 4000: 12550
// 4000: 7568

// ## Five Charts - 9000 points - Unoptimized

// 4000: 10106

// ## Six Charts - 9000 points - Optimized

// 4000: 12459
// 4000: 12483
// 4000: 12562

// ## Six Charts - 9000 points - Unoptimized

// 4000: 12208
// 4000: 11711
// 4000: 12411
