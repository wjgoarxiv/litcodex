---
tonality: ledger
title: Finance system migration, September 2026 status
date: 2026-10-05
department: Example Finance Transformation Office
presenter: Example Programme Manager
notice: Example data — replace with real figures
---

---
layout: cover-figures

# Finance system migration, September 2026 status
---

---
layout: kpi-row

## Programme status at month 4 of 9

| Workstreams on track | Scripts tested | Open defects | Budget spent | Days to go-live |
|---|---|---|---|---|
| 5 of 7 | 312 | 46 | 44% | 147 |
| August 6 of 7 | of 420; plan 340 | August 71, none critical | €1.38m of €3.1m | go-live 1 March 2027 |

> Programme dashboard, 30 September 2026 (example)

- Two workstreams slipped this month: data cleansing and the payroll interface
- Script testing is 28 scripts behind plan, all of them in the payroll interface
- Defects fell by a third as the vendor fixed the posting-rule batch
- Source: Example programme dashboard and finance ledger, 30 September 2026
- Note: on track means milestones within five working days of the baseline plan
---

---
layout: timeline
title: bottom-anchor

## Milestones to go-live, October 2026-March 2027

| When | Milestone | Owner |
|---|---|---|
| 16 Oct | Chart of accounts frozen | Finance Controller |
| 13 Nov | Data cleansing complete, all entities | Data Lead |
| 18 Dec | Payroll interface passes system test | Integration Lead |
| 29 Jan | Second dress rehearsal of the cut-over | Cut-over Lead |
| 1 Mar | Go-live for all four entities | Programme Manager |

> Table 1. Remaining baseline milestones; today is 5 October (example)

- The payroll interface milestone has three days of float left
- Source: Example integrated programme plan, version 7, September 2026
---

---
layout: ledger-table

## Workstream status, owners and next actions

| Workstream | Status | Progress | Owner | Next action | Due |
|---|---|---|---|---|---|
| General ledger | On track | 72% | Finance Controller | Freeze chart of accounts | 16 Oct |
| Payables | On track | 68% | AP Lead | Supplier master upload test | 23 Oct |
| Receivables | On track | 64% | AR Lead | Dunning rules sign-off | 30 Oct |
| Payroll interface | Late, 8 days | 41% | Integration Lead | Vendor patch for tax codes | 14 Oct |
| Data cleansing | Late, 5 days | 55% | Data Lead | Clear 3,800 duplicate suppliers | 13 Nov |
| Reporting | On track | 60% | Reporting Lead | Board pack prototype review | 6 Nov |
| Training | On track | 20% | Change Lead | Book super-user sessions | 31 Oct |

> Table 2. Workstream status on 30 September 2026 (example data)

- Both late workstreams depend on outside parties: the payroll vendor and entity finance teams
- The duplicate supplier backlog fell from 6,100 to 3,800 in September
- Source: Example workstream reports, 30 September 2026 (example)
- Note: progress is the share of planned deliverables accepted by the workstream owner
---

---
layout: chart-insight

## Migration scripts tested against plan, by week

::: chart type=line unit="scripts"
| Week | Plan | Actual |
|---|---|---|
| W31 | 120 | 118 |
| W33 | 170 | 165 |
| W35 | 220 | 212 |
| W37 | 270 | 251 |
| W39 | 340 | 312 |
> Cumulative migration scripts passed in test, plan against actual (example data)
:::

- The gap opened in week 35 when payroll tax-code scripts started failing
- Excluding payroll, testing is two scripts ahead of plan
- Source: Example test management tool, weeks 31-39, 2026 (example data)
---

---
layout: comparison

## Planned and actual spend by cost line

:::: columns 1fr 1fr
::: col
- **Plan to end of September**
  (1) Vendor services: €720,000 for configuration and testing
  (2) Internal staff: €410,000 for 14 backfilled roles
  (3) Licences: €180,000 for the first year
  (4) Contingency: €85,000 drawn by month 4
  (5) Forecast at completion: €3.10m, the approved budget
:::
::: col
- **Actual to end of September**
  (1) Vendor services: €742,000, payroll rework adds €22,000
  (2) Internal staff: €388,000, two roles filled one month late
  (3) Licences: €180,000, as planned
  (4) Contingency: €70,000 drawn, €240,000 left
  (5) Forecast at completion: €3.12m if the payroll rework stays at €22,000
:::
::::

- Source: Example finance ledger, programme cost centre, 30 September 2026
---

---
layout: big-number

## Payroll interface risk and its effect on go-live

| Float left | Scripts failing | Cost if go-live moves one month |
|---|---|---|
| 3 days | 28 | €190,000 |
| before 18 Dec milestone | all in tax-code mapping | vendor and backfill |

> Programme risk register, 30 September 2026 (example)

- The vendor's tax-code patch, due 14 October, is the single largest risk to go-live
- If the patch slips past 21 October, the second dress rehearsal moves and go-live follows
- A fallback manual payroll file for two months is designed and costs €12,000
- Source: Example programme risk register and vendor plan, September 2026
---

---
layout: closing-decision-box

## Steering committee decisions, October 2026

| Decision | Cost | Owner | When |
|---|---|---|---|
| Approve fallback manual payroll file | €12,000 | Integration Lead | 12 Oct |
| Escalate tax-code patch to vendor executive | None | Programme Sponsor | 12 Oct |
| Release €22,000 of contingency for rework | €22,000 | Programme Manager | 12 Oct |

- Ask: approve the fallback file and the contingency release at the 12 October meeting
- Next step: the Integration Lead reports patch status daily until it passes system test
---
