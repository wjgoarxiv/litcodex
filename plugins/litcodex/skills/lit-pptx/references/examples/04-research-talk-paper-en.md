---
tonality: paper
title: Low-cost capacitive sensors for street-tree soil moisture
date: 2026-10-05
department: Example Urban Forestry Lab
presenter: Example Researcher
notice: Example data — replace with real figures
---

---
layout: cover-index

# Low-cost capacitive sensors for street-tree soil moisture
---

---
layout: text-column

## Research question, setting and approach

- **Question** Can a €9 capacitive probe track street-tree soil moisture well enough to schedule watering?
  (1) Reference probes cost about €180 each, so cities monitor a handful of trees at most
  (2) Young street trees die mostly in their first three summers, from drought stress
- **Setting** 60 newly planted lindens on four streets, structural soil pits, June-September 2026
  (1) Each pit holds one low-cost probe and one reference probe at 30 cm depth
  (2) Readings every 15 minutes, sent over a city LoRa network
- **Approach** Calibrate per soil batch, compare against the reference, then test a watering rule
  (1) Agreement measured as RMSE in volumetric water content (VWC)
  (2) The watering rule is judged by trees below the stress threshold for more than 48 hours
- Source: Example Urban Forestry Lab field protocol, version 2, May 2026 (example)
---

---
layout: section-rule

# Sensor agreement
---

---
layout: figure-academic

## Raw and calibrated readings against the reference probe

![Figure 1. Low-cost probe against reference probe, 60 pits, 15-minute readings | Source: example image](assets/example-a.png)

- **Observation** Raw readings follow the reference but read 6-9 points high in wet soil
- **Observation** After a two-point calibration per soil batch, RMSE falls from 7.8 to 2.1 VWC points
- **Basis** 498,000 paired readings from 60 pits over 14 weeks (example data)
- **Limitation** One soil mix and one depth; clay-rich pits were not in the sample
- **Implication** A per-batch calibration is enough; per-probe calibration adds 0.3 points of accuracy
- Source: Example Urban Forestry Lab field data, June-September 2026 (example data)
---

---
layout: method

## Two-point calibration and symbols

θ = a · (f − f_dry) / (f_wet − f_dry) + b

- **θ** volumetric water content, percent of soil volume; the quantity the watering rule reads
- **f** raw frequency count reported by the logger; it falls as the soil around the probe gets wetter
- **f_dry, f_wet** counts in oven-dry and saturated samples of the same soil batch, measured once per batch in the lab
- **a, b** slope and offset fitted against the reference probe on ten field samples per batch
- **RMSE** root mean square error against the reference, in VWC points; the study's accuracy measure
- **Stress threshold** 12% VWC for this soil mix, read from its pressure-plate curve at 1.5 MPa
- **Batch** one delivery of structural soil; five batches went into the four streets
- **Drift** change of the calibrated reading in saturated soil from June to September
- **Pit** the planting hole of one tree, 2.5 m³ of structural soil, one probe pair at 30 cm
- **Reference probe** a laboratory-grade sensor with its own factory calibration, used as ground truth
- **Watering rule** water a tree when its daily mean θ stays below 14% for two days running
- **Interval** one reading every 15 minutes; daily means use the 96 readings of each day
- Source: Example Urban Forestry Lab calibration sheet, version 2, June 2026
---

---
layout: chart-insight

## Calibration error by soil batch

::: chart type=column unit="VWC points"
| Soil batch | Raw RMSE | Calibrated RMSE |
|---|---|---|
| Batch A | 7.2 | 1.9 |
| Batch B | 8.4 | 2.3 |
| Batch C | 7.6 | 2.0 |
| Batch D | 8.1 | 2.2 |
| Batch E | 7.9 | 2.1 |
> RMSE against the reference probe by soil batch, VWC points (example data)
:::

- Calibration cuts the error by about three quarters in every batch
- Batch B stays highest because its organic fraction varied most between pits
- All five batches end within 0.4 points of each other after calibration
- Source: Example Urban Forestry Lab field data, June-September 2026 (example data)
---

---
layout: figure-pair

## Probe housing before and after the sealing change

![Figure 2. Original housing after eight weeks in the pit | Source: example image](assets/example-b.png)

![Figure 3. Resin-sealed housing after fourteen weeks | Source: example image](assets/example-b.png)

- Moisture entered the original housing at the cable gland; resin sealing stopped it, and drift fell from 4.6 to 0.8 points over the season
---

---
layout: table-insight

## Sensor cost and accuracy by option

| Option | Unit cost (€) | Calibrated RMSE | Drift per season | Battery life (months) |
|---|---|---|---|---|
| Reference probe | 180 | 0.0 | 0.3 | 24 |
| Low-cost, raw | 9 | 7.8 | 4.6 | 18 |
| Low-cost, batch calibration | 9 | 2.1 | 4.6 | 18 |
| Low-cost, calibrated and sealed | 11 | 2.1 | 0.8 | 18 |
| Low-cost, per-probe calibration | 9 | 1.8 | 4.6 | 18 |

> Table 1. Cost and accuracy of the five options tested, 60 pits (example data)

- Sealed, batch-calibrated probes cost 6% of a reference probe
- Their error of 2.1 points is well inside the 4-point margin of the watering rule
- Per-probe calibration gains 0.3 points for about 25 minutes of work per probe
- Source: Example Urban Forestry Lab cost records and field data, 2026 (example data)
- Note: drift is the change in the saturated-soil reading from June to September
---

---
layout: section-rule

# Watering by sensor
---

---
layout: full-chart

## Trees below the stress threshold by watering regime

::: chart type=line unit="trees"
| Week | Calendar watering | Sensor-triggered watering |
|---|---|---|
| W24 | 2 | 1 |
| W26 | 5 | 2 |
| W28 | 9 | 3 |
| W30 | 12 | 2 |
| W32 | 10 | 2 |
| W34 | 6 | 1 |
| W36 | 3 | 1 |
> Trees below 12% VWC for more than 48 hours, 30 trees per regime (example data)
:::

- Source: Example Urban Forestry Lab watering trial, weeks 24-36, 2026 (example data)
---

---
layout: comparison

## Contributions and limits of the study

:::: columns 1fr 1fr
::: col
- **Contributions**
  (1) Accuracy: €11 sealed probes reach 2.1 VWC points with one calibration per soil batch
  (2) Watering: sensor-triggered watering kept stressed trees at 3 or fewer in the hottest weeks
  (3) Water use: the sensor regime used 18% less water than the calendar regime
  (4) Method: calibration and sealing steps fit into one crew day for 60 pits
:::
::: col
- **Limits**
  (1) Accuracy: one structural soil mix and one depth; clay-rich pits are untested
  (2) Watering: one summer, which was 1.2 °C warmer than the ten-year mean
  (3) Water use: trucks still visited every tree; savings exclude route changes
  (4) Method: long-term drift beyond fourteen weeks is not yet measured
:::
::::

- Source: Example Urban Forestry Lab trial records, June-September 2026 (example data)
---

---
layout: closing-summary-list

## Findings and next season

- A €11 sealed capacitive probe tracks street-tree soil moisture within 2.1 VWC points
- One two-point calibration per soil batch is enough; per-probe calibration adds little
- Sensor-triggered watering held stressed trees to 3 or fewer per 30 in the hottest weeks, against 12 on the calendar
- The same regime used 18% less water across the season
- Next season: 400 trees on twelve streets, two soil mixes and two depths, starting May 2027
- Ask: access to the city's watering route data so that truck routes can follow the sensors
---

---
layout: references-appendix

## References and data sources

- [1] Example, A. and Sample, B. (2022). Capacitive soil moisture sensing at low cost. *Journal of Example Soil Science*, 18(3), 211-226.
- [2] Specimen, C. (2021). Drought mortality of young street trees. *Example Urban Forestry*, 47, 88-101.
- [3] Demo, D. et al. (2024). Structural soils for street trees, a review. *Example Arboriculture Review*, 9, 1-34.
- [4] Sample, E. (2023). LoRa networks for municipal sensing. *Example Smart City Letters*, 5, 40-52.
- [5] Example, F. (2020). Pressure-plate curves of urban soil mixes. *Journal of Example Soil Physics*, 12(1), 7-19.
- [6] Specimen, G. and Demo, H. (2025). Sealing low-cost sensors for buried use. *Example Sensor Notes*, 3, 101-109.
- [7] Example Urban Forestry Lab (2026). Field protocol and calibration sheets, version 2.
- [8] Example Urban Forestry Lab (2026). Street-tree soil moisture data set, synthetic, version 1.
- [9] VWC: volumetric water content, the volume of water over the volume of soil, in percent
- [10] Stress threshold: the VWC below which this soil mix holds water at more than 1.5 MPa suction
---
