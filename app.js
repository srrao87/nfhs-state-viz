(function () {
  const MODE_A_BUCKETS = [
    { id: "much-worse", label: "Much worse than India average", color: "#8b1e2d" },
    { id: "worse", label: "Worse than India average", color: "#c94f52" },
    { id: "slightly-worse", label: "Slightly worse than India average", color: "#e8a39f" },
    { id: "near", label: "Near India average", color: "#f3efe6" },
    { id: "slightly-better", label: "Slightly better than India average", color: "#b7d8bb" },
    { id: "better", label: "Better than India average", color: "#5fa06a" },
    { id: "best", label: "Best performers", color: "#1e6c3d" },
    { id: "missing", label: "Missing data", color: "#c7c2b8", missing: true },
  ];

  const MODE_B_BUCKETS = [
    { id: "highest-improvement", label: "Highest improvement", color: "#14a44d" },
    { id: "improvement", label: "Improvement", color: "#4c8f48" },
    { id: "no-change", label: "No change", color: "#d7d4ce" },
    { id: "worsened", label: "Worsened", color: "#dcb955" },
    { id: "extremely-worsened", label: "Extremely worsened", color: "#c23d3d" },
    { id: "missing", label: "Missing data", color: "#c7c2b8", missing: true },
  ];

  const TFR_SPECIAL_BUCKET = {
    id: "below-replacement",
    label: "Below replacement-level fertility, TFR < 2.1",
    color: "rgba(122, 71, 197, 0.12)",
    special: true,
  };

  const state = {
    dataset: null,
    geojson: null,
    indicator: null,
    mode: "india",
    analyticsCache: new Map(),
    legendSelection: null,
  };

  const ui = {
    indicatorSelect: document.querySelector("#indicator-select"),
    modeInputs: document.querySelectorAll('input[name="mode"]'),
    indicatorDetails: document.querySelector("#indicator-details"),
    hoverDetails: document.querySelector("#hover-details"),
    selectedStates: document.querySelector("#selected-states"),
    legendItems: document.querySelector("#legend-items"),
    legendNote: document.querySelector("#legend-note"),
    clearSelection: document.querySelector("#clear-selection"),
    appError: document.querySelector("#app-error"),
    tooltip: document.querySelector("#tooltip"),
    svg: d3.select("#map"),
  };

  function showAppError(message) {
    ui.appError.textContent = message;
    ui.appError.classList.remove("hidden");
    ui.indicatorDetails.innerHTML = `<p>${message}</p>`;
    ui.selectedStates.className = "stack muted";
    ui.selectedStates.textContent = "Unable to load the visualisation.";
    ui.hoverDetails.className = "stack muted";
    ui.hoverDetails.textContent = "Unable to load the visualisation.";
    ui.legendItems.innerHTML = "";
    ui.legendNote.textContent = "";
    ui.svg.selectAll("*").remove();
  }

  function clearAppError() {
    ui.appError.textContent = "";
    ui.appError.classList.add("hidden");
  }

  async function fetchJson(relativePath, label) {
    const response = await fetch(relativePath);
    if (!response.ok) {
      throw new Error(`${label} request failed with HTTP ${response.status} for ${relativePath}`);
    }
    try {
      return await response.json();
    } catch (error) {
      throw new Error(`${label} is not valid JSON at ${relativePath}: ${error.message}`);
    }
  }

  function roundToPrecision(value, precision) {
    if (value == null) {
      return null;
    }
    const factor = 10 ** precision;
    return Math.round(value * factor) / factor;
  }

  function formatValue(value, precision, unit) {
    if (value == null) {
      return "NA";
    }
    const fixed = Number(value).toFixed(precision);
    return unit === "%" ? `${fixed}%` : fixed;
  }

  function formatDiff(value, precision, unit) {
    if (value == null) {
      return "NA";
    }
    const sign = value > 0 ? "+" : "";
    const fixed = Number(value).toFixed(precision);
    return unit === "%" ? `${sign}${fixed} pp` : `${sign}${fixed}`;
  }

  function formatZ(value) {
    if (value == null || !Number.isFinite(value)) {
      return "NA";
    }
    return value.toFixed(2);
  }

  function formatPercentile(value) {
    if (value == null || !Number.isFinite(value)) {
      return "NA";
    }
    return `${value.toFixed(0)}`;
  }

  function compareAtPrintedPrecision(left, right, precision) {
    if (left == null || right == null) {
      return "missing";
    }
    const a = roundToPrecision(left, precision);
    const b = roundToPrecision(right, precision);
    if (a === b) {
      return "equal";
    }
    return a > b ? "higher" : "lower";
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function getIndicator() {
    return state.dataset.indicators.find((item) => item.id === state.indicator);
  }

  function getPolarity(indicator) {
    return indicator?.polarity ?? "positive";
  }

  function getRegionRecord(regionName) {
    return state.dataset.regions.find((item) => item.geojson_name === regionName);
  }

  function getRegionValue(regionName) {
    const region = getRegionRecord(regionName);
    return region ? region.values[state.indicator] : null;
  }

  function getFactsheetValues(regionName, indicator) {
    const region = state.dataset.regions.find((item) => item.geojson_name === regionName);
    return region ? region.values[indicator.id] : null;
  }

  function getGoodnessDiffFromIndia(regionName, indicator) {
    const values = getFactsheetValues(regionName, indicator);
    if (!values || values.nfhs6 == null || values.india_nfhs6 == null) {
      return null;
    }
    const rawDiffFromIndia = values.nfhs6 - values.india_nfhs6;
    return getPolarity(indicator) === "positive" ? rawDiffFromIndia : -rawDiffFromIndia;
  }

  function getImprovementScore(regionName, indicator) {
    const values = getFactsheetValues(regionName, indicator);
    if (!values || values.nfhs6 == null || values.nfhs5 == null) {
      return null;
    }
    if (compareAtPrintedPrecision(values.nfhs6, values.nfhs5, indicator.precision) === "equal") {
      return 0;
    }
    const rawChange = values.nfhs6 - values.nfhs5;
    return getPolarity(indicator) === "positive" ? rawChange : -rawChange;
  }

  function computeSpread(scores) {
    if (!scores.length) {
      return 1;
    }
    const mean = d3.mean(scores);
    const variance = d3.mean(scores.map((score) => (score - mean) ** 2));
    const standardDeviation = Math.sqrt(variance ?? 0);
    if (standardDeviation > 0) {
      return standardDeviation;
    }
    const maxAbs = d3.max(scores.map((score) => Math.abs(score))) ?? 1;
    return maxAbs || 1;
  }

  function computeRankMaps(entries, scoreKey) {
    const descending = [...entries].sort((a, b) => b[scoreKey] - a[scoreKey] || a.regionName.localeCompare(b.regionName));
    const ascending = [...entries].sort((a, b) => a[scoreKey] - b[scoreKey] || a.regionName.localeCompare(b.regionName));
    const rankMap = new Map();
    const percentileMap = new Map();

    let lastScoreDesc = null;
    let currentRank = 0;
    descending.forEach((entry, index) => {
      if (lastScoreDesc === null || entry[scoreKey] !== lastScoreDesc) {
        currentRank = index + 1;
        lastScoreDesc = entry[scoreKey];
      }
      rankMap.set(entry.regionName, currentRank);
    });

    const groupedAscending = d3.groups(ascending, (entry) => entry[scoreKey]);
    let position = 0;
    groupedAscending.forEach(([, group]) => {
      const start = position;
      const end = position + group.length - 1;
      const averagePosition = (start + end) / 2;
      const percentile = ascending.length <= 1 ? 100 : (averagePosition / (ascending.length - 1)) * 100;
      group.forEach((entry) => percentileMap.set(entry.regionName, percentile));
      position += group.length;
    });

    return { rankMap, percentileMap, descending };
  }

  function getModeABucketByZ(zValue) {
    if (zValue == null) {
      return MODE_A_BUCKETS.find((bucket) => bucket.id === "missing");
    }
    if (zValue <= -2) {
      return MODE_A_BUCKETS[0];
    }
    if (zValue <= -1) {
      return MODE_A_BUCKETS[1];
    }
    if (zValue < -0.25) {
      return MODE_A_BUCKETS[2];
    }
    if (zValue <= 0.25) {
      return MODE_A_BUCKETS[3];
    }
    if (zValue < 1) {
      return MODE_A_BUCKETS[4];
    }
    if (zValue < 2) {
      return MODE_A_BUCKETS[5];
    }
    return MODE_A_BUCKETS[6];
  }

  function getModeBBucketByScore(entry) {
    if (entry == null) {
      return MODE_B_BUCKETS.find((bucket) => bucket.id === "missing");
    }
    if (entry.isEqual) {
      return MODE_B_BUCKETS.find((bucket) => bucket.id === "no-change");
    }
    if (entry.improvementScore > 0 && entry.changeZ >= 1) {
      return MODE_B_BUCKETS.find((bucket) => bucket.id === "highest-improvement");
    }
    if (entry.improvementScore > 0) {
      return MODE_B_BUCKETS.find((bucket) => bucket.id === "improvement");
    }
    if (entry.improvementScore < 0 && entry.changeZ <= -1) {
      return MODE_B_BUCKETS.find((bucket) => bucket.id === "extremely-worsened");
    }
    return MODE_B_BUCKETS.find((bucket) => bucket.id === "worsened");
  }

  function getModeAPercentiles(indicator) {
    const entries = state.geojson.features.map((feature) => {
      const regionName = feature.properties.name;
      const values = getFactsheetValues(regionName, indicator);
      const goodnessDiffFromIndia = getGoodnessDiffFromIndia(regionName, indicator);
      return { regionName, values, goodnessDiffFromIndia };
    });

    const validEntries = entries.filter((entry) => entry.goodnessDiffFromIndia != null);
    const spread = computeSpread(validEntries.map((entry) => entry.goodnessDiffFromIndia));
    const { rankMap, percentileMap, descending } = computeRankMaps(validEntries, "goodnessDiffFromIndia");

    const byRegion = new Map();
    entries.forEach((entry) => {
      if (entry.goodnessDiffFromIndia == null) {
        byRegion.set(entry.regionName, {
          ...entry,
          zFromIndia: null,
          zFromIndiaClamped: null,
          percentile: null,
          rank: null,
          bucket: MODE_A_BUCKETS.find((bucket) => bucket.id === "missing"),
          status: "Data unavailable",
        });
        return;
      }
      const zFromIndia = entry.goodnessDiffFromIndia / spread;
      const zFromIndiaClamped = clamp(zFromIndia, -2.5, 2.5);
      const bucket = getModeABucketByZ(zFromIndiaClamped);
      const roundedComparison = compareAtPrintedPrecision(entry.values.nfhs6, entry.values.india_nfhs6, indicator.precision);
      byRegion.set(entry.regionName, {
        ...entry,
        zFromIndia,
        zFromIndiaClamped,
        percentile: percentileMap.get(entry.regionName),
        rank: rankMap.get(entry.regionName),
        bucket,
        status:
          roundedComparison === "equal"
            ? "Same as India average"
            : entry.goodnessDiffFromIndia > 0
              ? "Better than India average"
              : "Worse than India average",
      });
    });

    return {
      type: "india",
      spread,
      byRegion,
      ordered: descending,
      bucketDefs: MODE_A_BUCKETS,
    };
  }

  function getModeABucket(regionName, indicator) {
    return getModeAPercentiles(indicator).byRegion.get(regionName)?.bucket ?? MODE_A_BUCKETS.find((bucket) => bucket.id === "missing");
  }

  function getModeBPercentiles(indicator) {
    const entries = state.geojson.features.map((feature) => {
      const regionName = feature.properties.name;
      const values = getFactsheetValues(regionName, indicator);
      const improvementScore = getImprovementScore(regionName, indicator);
      const isEqual =
        values &&
        values.nfhs6 != null &&
        values.nfhs5 != null &&
        compareAtPrintedPrecision(values.nfhs6, values.nfhs5, indicator.precision) === "equal";
      return { regionName, values, improvementScore, isEqual };
    });

    const validEntries = entries.filter((entry) => entry.improvementScore != null);
    const spread = computeSpread(validEntries.map((entry) => entry.improvementScore));
    const { rankMap, percentileMap, descending } = computeRankMaps(validEntries, "improvementScore");

    const byRegion = new Map();
    entries.forEach((entry) => {
      if (entry.improvementScore == null) {
        byRegion.set(entry.regionName, {
          ...entry,
          changeZ: null,
          changeZClamped: null,
          percentile: null,
          rank: null,
          bucket: MODE_B_BUCKETS.find((bucket) => bucket.id === "missing"),
          status: "Data unavailable",
        });
        return;
      }
      const changeZ = entry.improvementScore / spread;
      const changeZClamped = clamp(changeZ, -2.5, 2.5);
      const enriched = {
        ...entry,
        changeZ,
        changeZClamped,
        percentile: percentileMap.get(entry.regionName),
        rank: rankMap.get(entry.regionName),
      };
      const bucket = getModeBBucketByScore(enriched);
      byRegion.set(entry.regionName, {
        ...enriched,
        bucket,
        status: entry.isEqual
          ? "No change since NFHS-5"
          : entry.improvementScore > 0
            ? "Improved since NFHS-5"
            : "Worsened since NFHS-5",
      });
    });

    return {
      type: "nfhs5",
      spread,
      byRegion,
      ordered: descending,
      bucketDefs: MODE_B_BUCKETS,
    };
  }

  function getModeBBucket(regionName, indicator) {
    return getModeBPercentiles(indicator).byRegion.get(regionName)?.bucket ?? MODE_B_BUCKETS.find((bucket) => bucket.id === "missing");
  }

  function isBelowReplacementFertility(regionName, indicator) {
    if (!indicator || !/total fertility rate|tfr/i.test(indicator.label)) {
      return false;
    }
    const values = getFactsheetValues(regionName, indicator);
    return Boolean(values && values.nfhs6 != null && values.nfhs6 < 2.1);
  }

  function getAnalytics() {
    const cacheKey = `${state.mode}:${state.indicator}`;
    if (state.analyticsCache.has(cacheKey)) {
      return state.analyticsCache.get(cacheKey);
    }
    const indicator = getIndicator();
    const analytics = state.mode === "india" ? getModeAPercentiles(indicator) : getModeBPercentiles(indicator);
    state.analyticsCache.set(cacheKey, analytics);
    return analytics;
  }

  function getEntry(regionName) {
    return getAnalytics().byRegion.get(regionName);
  }

  function getBucketCount(bucketId) {
    const analytics = getAnalytics();
    let count = 0;
    analytics.byRegion.forEach((entry) => {
      if (entry.bucket.id === bucketId) {
        count += 1;
      }
    });
    return count;
  }

  function getTfrCount() {
    const indicator = getIndicator();
    return state.geojson.features.filter((feature) => isBelowReplacementFertility(feature.properties.name, indicator)).length;
  }

  function getSelectionMatch(regionName) {
    if (!state.legendSelection) {
      return true;
    }
    const indicator = getIndicator();
    if (state.legendSelection.type === "tfr") {
      return isBelowReplacementFertility(regionName, indicator);
    }
    return getEntry(regionName)?.bucket.id === state.legendSelection.id;
  }

  function handleLegendClick(bucketId, type = "bucket") {
    if (state.legendSelection && state.legendSelection.id === bucketId && state.legendSelection.type === type) {
      clearLegendSelection();
      return;
    }
    state.legendSelection = { id: bucketId, type };
    drawMap();
  }

  function clearLegendSelection() {
    state.legendSelection = null;
    drawMap();
  }

  function renderIndicatorSelect() {
    ui.indicatorSelect.innerHTML = "";
    state.dataset.indicators.forEach((indicator) => {
      const option = document.createElement("option");
      option.value = indicator.id;
      option.textContent = indicator.display_label;
      ui.indicatorSelect.append(option);
    });
    state.indicator = state.dataset.indicators[0].id;
    ui.indicatorSelect.value = state.indicator;
  }

  function updateLegend() {
    const analytics = getAnalytics();
    const indicator = getIndicator();
    ui.legendItems.innerHTML = "";
    ui.legendNote.textContent =
      state.mode === "india"
        ? "Stronger colour intensity means farther from the printed India NFHS-6 value, after adjusting for indicator polarity."
        : "Stronger colour intensity means greater improvement or regression since NFHS-5, after adjusting for indicator polarity.";

    analytics.bucketDefs.forEach((bucket) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `legend-item${state.legendSelection?.type === "bucket" && state.legendSelection.id === bucket.id ? " active" : ""}`;
      button.innerHTML = `
        <span class="swatch ${bucket.missing ? "missing-style" : ""}" style="background:${bucket.color}"></span>
        <span class="legend-item-label">${bucket.label}</span>
        <span class="legend-item-count">${getBucketCount(bucket.id)}</span>
      `;
      button.addEventListener("click", () => handleLegendClick(bucket.id, "bucket"));
      ui.legendItems.append(button);
    });

    if (/total fertility rate|tfr/i.test(indicator.label)) {
      const tfrButton = document.createElement("button");
      tfrButton.type = "button";
      tfrButton.className = `legend-item${state.legendSelection?.type === "tfr" ? " active" : ""}`;
      tfrButton.innerHTML = `
        <span class="swatch tfr-style"></span>
        <span class="legend-item-label">${TFR_SPECIAL_BUCKET.label}</span>
        <span class="legend-item-count">${getTfrCount()}</span>
      `;
      tfrButton.addEventListener("click", () => handleLegendClick(TFR_SPECIAL_BUCKET.id, "tfr"));
      ui.legendItems.append(tfrButton);
    }
  }

  function updateSelectedStatesPanel() {
    if (!state.legendSelection) {
      ui.selectedStates.className = "stack muted";
      ui.selectedStates.textContent = "Click a legend bucket to select matching states and UTs.";
      return;
    }

    const indicator = getIndicator();
    const matched = state.geojson.features
      .map((feature) => feature.properties.name)
      .filter((regionName) => getSelectionMatch(regionName))
      .sort((a, b) => a.localeCompare(b));

    const label =
      state.legendSelection.type === "tfr"
        ? TFR_SPECIAL_BUCKET.label
        : getAnalytics().bucketDefs.find((bucket) => bucket.id === state.legendSelection.id)?.label;

    ui.selectedStates.className = "stack";
    ui.selectedStates.innerHTML = `
      <p><span class="label">Selected bucket</span><br><span class="value">${label}</span></p>
      <p><span class="label">Matching states and UTs</span><br><span class="value">${matched.length}</span></p>
      <ul>${matched.map((name) => `<li>${name}${isBelowReplacementFertility(name, indicator) ? " (below replacement level)" : ""}</li>`).join("")}</ul>
    `;
  }

  function updateIndicatorDetails() {
    const indicator = getIndicator();
    const analytics = getAnalytics();
    const validEntries = analytics.ordered;
    const best = validEntries[0];
    const worst = validEntries[validEntries.length - 1];

    ui.indicatorDetails.innerHTML = `
      <p><span class="label">Indicator</span><br><span class="value">${indicator.display_label}</span></p>
      <p><span class="label">Polarity</span><br><span class="value">${getPolarity(indicator)}</span></p>
      <p><span class="label">India NFHS-6 value</span><br><span class="value">${formatValue(indicator.india_nfhs6, indicator.precision, indicator.unit)}</span></p>
      <p><span class="label">States and UTs with data</span><br><span class="value">${validEntries.length}</span></p>
      <p><span class="label">Best-performing state or UT</span><br><span class="value">${best ? best.regionName : "NA"}</span></p>
      <p><span class="label">Worst-performing state or UT</span><br><span class="value">${worst ? worst.regionName : "NA"}</span></p>
      <p><span class="label">Explanation</span><br><span class="value">${
        state.mode === "india"
          ? "Colours are centred on the India NFHS-6 value and intensify as states move farther from that reference point."
          : "Colours show improvement or regression from the same state or UT’s NFHS-5 value."
      }</span></p>
      ${
        /total fertility rate|tfr/i.test(indicator.label)
          ? `<p><span class="label">Fertility note</span><br><span class="value">Purple marking indicates TFR below replacement level, defined here as less than 2.1.</span></p>`
          : ""
      }
    `;
  }

  function renderHoverPanel(regionName, entry) {
    const indicator = getIndicator();
    const values = getRegionValue(regionName);
    if (!values || !entry || entry.bucket.id === "missing") {
      ui.hoverDetails.className = "stack";
      ui.hoverDetails.innerHTML = `
        <p><span class="label">State or UT</span><br><span class="value">${regionName}</span></p>
        <p><span class="label">Status</span><br><span class="value">Data unavailable</span></p>
      `;
      return;
    }

    if (state.mode === "india") {
      const rawDiff = values.nfhs6 - values.india_nfhs6;
      ui.hoverDetails.className = "stack";
      ui.hoverDetails.innerHTML = `
        <p><span class="label">State or UT</span><br><span class="value">${regionName}</span></p>
        <p><span class="label">Indicator</span><br><span class="value">${indicator.display_label}</span></p>
        <p><span class="label">Polarity</span><br><span class="value">${indicator.polarity}</span></p>
        <p><span class="label">NFHS-6 state or UT value</span><br><span class="value">${formatValue(values.nfhs6, indicator.precision, indicator.unit)}</span></p>
        <p><span class="label">India NFHS-6 value</span><br><span class="value">${formatValue(values.india_nfhs6, indicator.precision, indicator.unit)}</span></p>
        <p><span class="label">NFHS-5 state or UT value</span><br><span class="value">${formatValue(values.nfhs5, indicator.precision, indicator.unit)}</span></p>
        <p><span class="label">Difference from India average</span><br><span class="value">${formatDiff(rawDiff, indicator.precision, indicator.unit)}</span></p>
        <p><span class="label">Status</span><br><span class="value">${entry.status}</span></p>
        <p><span class="label">Percentile among states and UTs</span><br><span class="value">${formatPercentile(entry.percentile)}</span></p>
        <p><span class="label">Rank among states and UTs</span><br><span class="value">${entry.rank ?? "NA"}</span></p>
        <p><span class="label">z-score from India average</span><br><span class="value">${formatZ(entry.zFromIndia)}</span></p>
        <p><span class="label">Colour bucket</span><br><span class="value">${entry.bucket.label}</span></p>
        ${
          isBelowReplacementFertility(regionName, indicator)
            ? `<p><span class="label">Replacement-level benchmark</span><br><span class="value">2.1</span></p>
               <p><span class="label">Fertility status</span><br><span class="value">Below replacement level</span></p>`
            : /total fertility rate|tfr/i.test(indicator.label)
              ? `<p><span class="label">Replacement-level benchmark</span><br><span class="value">2.1</span></p>
                 <p><span class="label">Fertility status</span><br><span class="value">At/above replacement level</span></p>`
              : ""
        }
      `;
      return;
    }

    const rawChange = values.nfhs6 - values.nfhs5;
    ui.hoverDetails.className = "stack";
    ui.hoverDetails.innerHTML = `
      <p><span class="label">State or UT</span><br><span class="value">${regionName}</span></p>
      <p><span class="label">Indicator</span><br><span class="value">${indicator.display_label}</span></p>
      <p><span class="label">Polarity</span><br><span class="value">${indicator.polarity}</span></p>
      <p><span class="label">NFHS-6 state or UT value</span><br><span class="value">${formatValue(values.nfhs6, indicator.precision, indicator.unit)}</span></p>
      <p><span class="label">NFHS-5 state or UT value</span><br><span class="value">${formatValue(values.nfhs5, indicator.precision, indicator.unit)}</span></p>
      <p><span class="label">Raw change from NFHS-5 to NFHS-6</span><br><span class="value">${formatDiff(rawChange, indicator.precision, indicator.unit)}</span></p>
      <p><span class="label">Improvement score after polarity adjustment</span><br><span class="value">${formatDiff(entry.improvementScore, indicator.precision, indicator.unit)}</span></p>
      <p><span class="label">Status</span><br><span class="value">${entry.status}</span></p>
      <p><span class="label">Improvement percentile</span><br><span class="value">${formatPercentile(entry.percentile)}</span></p>
      <p><span class="label">Rank by improvement</span><br><span class="value">${entry.rank ?? "NA"}</span></p>
      <p><span class="label">changeZ</span><br><span class="value">${formatZ(entry.changeZ)}</span></p>
      <p><span class="label">Colour bucket</span><br><span class="value">${entry.bucket.label}</span></p>
      ${
        isBelowReplacementFertility(regionName, indicator)
          ? `<p><span class="label">Replacement-level benchmark</span><br><span class="value">2.1</span></p>
             <p><span class="label">Fertility status</span><br><span class="value">Below replacement level</span></p>`
          : /total fertility rate|tfr/i.test(indicator.label)
            ? `<p><span class="label">Replacement-level benchmark</span><br><span class="value">2.1</span></p>
               <p><span class="label">Fertility status</span><br><span class="value">At/above replacement level</span></p>`
            : ""
      }
    `;
  }

  function renderTooltip(event, regionName, entry) {
    const indicator = getIndicator();
    const values = getRegionValue(regionName);
    if (!indicator || !values || !entry || entry.bucket.id === "missing") {
      ui.tooltip.innerHTML = `<strong>${regionName}</strong><br>Data unavailable`;
      ui.tooltip.classList.remove("hidden");
      ui.tooltip.style.left = `${event.offsetX + 16}px`;
      ui.tooltip.style.top = `${event.offsetY + 16}px`;
      return;
    }

    if (state.mode === "india") {
      const rawDiff = values.nfhs6 - values.india_nfhs6;
      ui.tooltip.innerHTML = `
        <strong>${regionName}</strong><br>
        ${indicator.display_label}<br>
        Polarity: ${indicator.polarity}<br>
        NFHS-6: ${formatValue(values.nfhs6, indicator.precision, indicator.unit)}<br>
        India NFHS-6: ${formatValue(values.india_nfhs6, indicator.precision, indicator.unit)}<br>
        NFHS-5: ${formatValue(values.nfhs5, indicator.precision, indicator.unit)}<br>
        Difference from India: ${formatDiff(rawDiff, indicator.precision, indicator.unit)}<br>
        Status: ${entry.status}<br>
        Percentile: ${formatPercentile(entry.percentile)}<br>
        Rank: ${entry.rank ?? "NA"}<br>
        z-score: ${formatZ(entry.zFromIndia)}<br>
        Bucket: ${entry.bucket.label}
      `;
    } else {
      const rawChange = values.nfhs6 - values.nfhs5;
      ui.tooltip.innerHTML = `
        <strong>${regionName}</strong><br>
        ${indicator.display_label}<br>
        Polarity: ${indicator.polarity}<br>
        NFHS-6: ${formatValue(values.nfhs6, indicator.precision, indicator.unit)}<br>
        NFHS-5: ${formatValue(values.nfhs5, indicator.precision, indicator.unit)}<br>
        Raw change: ${formatDiff(rawChange, indicator.precision, indicator.unit)}<br>
        Improvement score: ${formatDiff(entry.improvementScore, indicator.precision, indicator.unit)}<br>
        Status: ${entry.status}<br>
        Improvement percentile: ${formatPercentile(entry.percentile)}<br>
        Rank: ${entry.rank ?? "NA"}<br>
        changeZ: ${formatZ(entry.changeZ)}<br>
        Bucket: ${entry.bucket.label}
      `;
    }

    if (/total fertility rate|tfr/i.test(indicator.label)) {
      ui.tooltip.innerHTML += `<br>Replacement-level benchmark: 2.1<br>Status: ${
        isBelowReplacementFertility(regionName, indicator) ? "Below replacement level" : "At/above replacement level"
      }`;
    }

    ui.tooltip.classList.remove("hidden");
    ui.tooltip.style.left = `${event.offsetX + 16}px`;
    ui.tooltip.style.top = `${event.offsetY + 16}px`;
  }

  function drawMap() {
    ui.svg.selectAll("*").remove();
    const indicator = getIndicator();
    const projection = d3.geoMercator().fitSize([900, 900], state.geojson);
    const path = d3.geoPath(projection);

    const defs = ui.svg.append("defs");
    const missingPattern = defs
      .append("pattern")
      .attr("id", "missing-pattern")
      .attr("patternUnits", "userSpaceOnUse")
      .attr("width", 10)
      .attr("height", 10)
      .attr("patternTransform", "rotate(45)");

    missingPattern
      .append("rect")
      .attr("width", 10)
      .attr("height", 10)
      .attr("fill", "#c7c2b8");

    missingPattern
      .append("line")
      .attr("x1", 0)
      .attr("y1", 0)
      .attr("x2", 0)
      .attr("y2", 10)
      .attr("stroke", "rgba(255,255,255,0.75)")
      .attr("stroke-width", 3);

    ui.svg
      .append("rect")
      .attr("class", "map-bg")
      .attr("width", 900)
      .attr("height", 900)
      .on("click", clearLegendSelection);

    const regionsGroup = ui.svg.append("g");

    regionsGroup
      .selectAll("path")
      .data(state.geojson.features)
      .join("path")
      .attr("class", (feature) => {
        const regionName = feature.properties.name;
        const classes = ["region"];
        if (state.legendSelection && !getSelectionMatch(regionName)) {
          classes.push("dimmed");
        }
        if (state.legendSelection && getSelectionMatch(regionName)) {
          classes.push("selected");
        }
        return classes.join(" ");
      })
      .attr("fill", (feature) => {
        const bucket = getEntry(feature.properties.name).bucket;
        return bucket.id === "missing" ? "url(#missing-pattern)" : bucket.color;
      })
      .attr("d", path)
      .on("mousemove", function (event, feature) {
        event.stopPropagation();
        const regionName = feature.properties.name;
        const entry = getEntry(regionName);
        renderTooltip(event, regionName, entry);
        renderHoverPanel(regionName, entry);
        d3.select(this).classed("hovered", true);
      })
      .on("mouseleave", function () {
        ui.tooltip.classList.add("hidden");
        ui.hoverDetails.className = "stack muted";
        ui.hoverDetails.textContent = "Hover over a state or union territory.";
        d3.select(this).classed("hovered", false);
      })
      .on("click", function (event) {
        event.stopPropagation();
      });

    const fertilityFeatures = state.geojson.features.filter((feature) =>
      isBelowReplacementFertility(feature.properties.name, indicator),
    );

    if (fertilityFeatures.length) {
      ui.svg
        .append("g")
        .selectAll("path")
        .data(fertilityFeatures)
        .join("path")
        .attr("class", (feature) => {
          const regionName = feature.properties.name;
          const classes = ["fertility-overlay"];
          if (state.legendSelection && !getSelectionMatch(regionName)) {
            classes.push("dimmed");
          }
          return classes.join(" ");
        })
        .attr("d", path);
    }

    updateLegend();
    updateIndicatorDetails();
    updateSelectedStatesPanel();
  }

  async function bootstrap() {
    clearAppError();
    const [dataset, geojson] = await Promise.all([
      fetchJson("./data/nfhs_state_indicators.json", "Indicator dataset"),
      fetchJson("./data/india_states_ut.geojson", "GeoJSON boundary file"),
    ]);

    state.dataset = dataset;
    state.geojson = geojson;
    renderIndicatorSelect();
    drawMap();

    ui.indicatorSelect.addEventListener("change", (event) => {
      state.indicator = event.target.value;
      state.legendSelection = null;
      drawMap();
    });

    ui.modeInputs.forEach((input) => {
      input.addEventListener("change", (event) => {
        state.mode = event.target.value;
        state.legendSelection = null;
        drawMap();
      });
    });

    ui.clearSelection.addEventListener("click", clearLegendSelection);
  }

  bootstrap().catch((error) => {
    console.error(error);
    showAppError(`Failed to load the app data. ${error.message}`);
  });
})();
