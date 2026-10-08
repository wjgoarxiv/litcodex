---
tonality: chalk
title: Reading a centrifugal pump curve
date: 2026-10-05
department: Example Plant Engineering Academy
presenter: Example Instructor
notice: Example data — replace with real figures
---

---
layout: cover-numeral

# Reading a centrifugal pump curve, plant engineering module
---

---
layout: agenda

## Session goals and order

- **The curve and the system** what the head-flow curve says and where the system curve crosses it
- **Choosing a pump** four steps from duty point to a shortlisted model
- **Speed and the affinity laws** how a drive changes flow, head and power
- **Mistakes and exercise** the three most common errors and this week's task
---

---
layout: section-numeral

# The curve and the system
---

---
layout: method

## Duty point and system curve

H_sys = H_static + k · Q²

- **H_sys** head the system needs at flow Q, in metres of liquid
- **H_static** height difference between suction and delivery levels, 12 m in the example
- **k** friction coefficient of the pipework, from pipe length, diameter and fittings
- **Q** flow rate in m³/h; friction head grows with its square
- **Pump curve** head the pump delivers at each flow, published by the maker at one speed
- **Duty point** where the pump curve crosses the system curve; the pump runs there whether you like it or not
- **BEP** best efficiency point, the flow at which the pump wastes least energy
- **Preferred range** 70-120% of BEP flow; outside it, wear and vibration rise
- **NPSHr** suction head the pump needs to avoid cavitation, also read from the maker's sheet
- **NPSHa** suction head the installation provides; keep it at least 1 m above NPSHr
- **Shut-off head** head at zero flow, the left end of the pump curve
- Source: Example Plant Engineering Academy course notes, module 2, 2026
---

---
layout: image-split

## Worked example: cooling-water duty at 180 m³/h

![Figure 1. Pump and system curves for the cooling-water loop | Source: example image](assets/example-b.png)

- **Need** 180 m³/h against 12 m static head and 1,400 m of 200 mm pipe
- **System curve** H = 12 + 0.00062 · Q², so 32 m at 180 m³/h
- **Candidate** model B curve crosses at 184 m³/h and 32.5 m
- **Efficiency** 81% at the duty point, BEP 83% at 200 m³/h
- **Position** duty flow is 92% of BEP flow, inside the preferred range
- **Suction** NPSHa 6.8 m against NPSHr 3.9 m, margin 2.9 m
- Source: Example cooling-water loop design data and maker curve sheet (example data)
---

---
layout: section-numeral

# Choosing a pump
---

---
layout: step-diagram

## Four steps from duty point to shortlist

- **1. Fix the duty** Write the flow you need and the head the system needs at that flow
  (1) Example: 180 m³/h at 32 m, from the system curve
  (2) Check: add 5-10% head margin only once, not at every step
- **2. Screen the curves** Keep models whose curves cross the system curve within 5% of the duty flow
  (1) Example: models A, B and C pass; D crosses at 230 m³/h
  (2) Check: read each curve at the speed you will actually run
- **3. Check efficiency and range** Keep duty flow between 70% and 120% of each model's BEP flow
  (1) Example: B sits at 92% of BEP, C at 64% and drops out
  (2) Check: compare power at the duty point, not the peak efficiency figure
- **4. Check suction** Confirm NPSHa exceeds NPSHr by at least 1 m at the duty flow
  (1) Example: B has a 2.9 m margin, A only 0.6 m
  (2) Check: use the lowest tank level and the hottest water temperature
- Source: Example Plant Engineering Academy selection checklist, version 3
---

---
layout: table-insight

## Candidate pumps at the 180 m³/h duty

| Model | Flow at crossing (m³/h) | Head (m) | Efficiency (%) | Share of BEP flow (%) | NPSH margin (m) |
|---|---|---|---|---|---|
| A | 178 | 31.8 | 79 | 104 | 0.6 |
| B | 184 | 32.5 | 81 | 92 | 2.9 |
| C | 188 | 32.9 | 72 | 64 | 3.4 |
| D | 230 | 37.0 | 76 | 115 | 2.1 |
| E | 171 | 31.4 | 77 | 88 | 2.5 |

> Table 1. Five candidate pumps read at the duty point (example data)

- Model B is the only one that passes all four steps
- Model A has the best range position but too little suction margin
- Model D overshoots the duty by 28% and would need throttling all its life
- Source: Example maker curve sheets, 1,480 rpm, read for this exercise (example data)
- Note: share of BEP flow is the crossing flow over the model's best efficiency flow
---

---
layout: comparison

## Throttling valve and speed drive at 140 m³/h

:::: columns 1fr 1fr
::: col
- **Throttling valve**
  (1) How: close a valve to steepen the system curve until it crosses at 140 m³/h
  (2) Head: the pump climbs its curve to 36 m, 9 m more than the system needs
  (3) Power: 19.5 kW at the shaft, most of the extra head burnt in the valve
  (4) Cost: no new equipment, higher energy bill every hour it runs
:::
::: col
- **Speed drive**
  (1) How: slow the pump to 1,150 rpm so its curve meets the system curve at 140 m³/h
  (2) Head: 24 m, exactly what the system needs at that flow
  (3) Power: 12.4 kW at the shaft, from the affinity laws (P ∝ n³)
  (4) Cost: a drive at about €6,000, paid back in 14 months at 6,000 hours a year
:::
::::

- Source: Example cooling-water loop calculation, electricity at €0.14 per kWh (example data)
---

---
layout: sidebar-note

## Three common curve-reading mistakes

- **Stacking safety margins**
  (1) Margins added at flow, head and motor size multiply into an oversized pump
  (2) The pump then runs far left of BEP and wears its bearings early
- **Reading the curve at the wrong speed**
  (1) Maker sheets are drawn at one speed; a 4-pole motor on 60 Hz runs about 20% faster than on 50 Hz
  (2) Head rises with speed squared, so the duty point moves a long way
- **Ignoring the lowest tank level**
  (1) NPSHa checked at the normal level can pass while the low level fails
  (2) Cavitation then starts on the first dry week of the year

::: main-box
Read every value at the duty point and the actual speed: flow, head, efficiency, power and NPSH margin. A pump chosen by its peak efficiency figure alone is usually chosen wrong

Example: pump B at 180 m³/h and 1,780 rpm gives 32 m, 78% efficiency, 20 kW and a 2.9 m NPSH margin; the same pump read at 1,480 rpm would look 30% short of head
:::
---

---
layout: closing-summary-list

## Summary and this week's exercise

- The pump always runs where its curve crosses the system curve; selection is choosing where that is
- Shortlist in four steps: fix the duty, screen curves, check BEP range, check suction margin
- At part flow, a speed drive saves energy that a throttling valve burns as extra head
- Exercise: select a pump for 95 m³/h against the attached hot-water loop, using the five supplied curves
- Submit one page with your system curve, shortlist table and chosen model by Thursday 12:00
- Next session: parallel pumps and what happens to the duty point when the second pump starts
---
