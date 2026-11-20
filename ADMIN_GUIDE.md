# Admin Guide: Injex Clinics Platform

For administrators running the dashboard day to day. No technical knowledge needed.
(Developers: setup and deployment are in [README.md](README.md).)

---

## 1. How it works in one minute

1. Each **employee** fills in a short **daily entry** (their figures for the day) and submits it.
2. **You review** each submission: approve it, ask for a correction, or reject it.
3. **Only approved entries count.** They feed the leaderboard, reports, charts and points.
4. **Points** are credited automatically from the scoring rules you set (and from goals employees achieve) once each day, week or month is over.
5. Employees **spend points on rewards** from your catalogue. You approve each request and hand the reward over.

Everything you and your staff do is recorded in the **Audit log**.

---

## 2. First-time setup (do this once, in this order)

| Step | Where | What to do |
| --- | --- | --- |
| 1 | **Employees** | Add each team member with their name, email and category (Nurse or Beauty Therapist). They get an email to set their password. |
| 2 | **Goals & Scoring → Beauty Therapist** | Add the Beauty Therapist daily metrics (the Nurse form is already set up from the spreadsheet). |
| 3 | **Goals & Scoring** (each category) | Add **scoring rules**: what result earns how many points (see section 4). |
| 4 | **Settings → Points** | Check the **Points start date**: points are only earned from this date. |
| 5 | **Rewards** | Add rewards with their points price and stock. |
| 6 | **Settings → Leaderboard** | Decide whether employees can see the overall (all-categories) leaderboard. |

---

## 3. Daily forms and goals (Goals & Scoring)

Pick the category at the top, then:

- **Add metric**: a figure staff enter each day (e.g. *Services*) or a **calculated** one (e.g. *Revenue ÷ Hours*).
  - *Required*: must be filled in to submit.
  - *Default target*: shown on the daily form as a guide.
  - *Counts as a treatment unit* (Nurses): included in *Units per hour*.
  - *Goal eligible*: employees can set goals on it.
  - *Scoring eligible*: you can attach scoring rules to it.
- **Edit / disable** a metric any time. Past entries keep the name and value they had; disabling hides it from new entries.
- Metrics can't be deleted once used (history is kept).

**Employees set their own goals** (daily, weekly or monthly) on goal-eligible metrics. A goal earns points only if it
was set *before* they submitted any entry for that period, so nobody can set a goal after seeing their results.

---

## 4. Scoring rules and points

A **scoring rule** says: *reaching this result over this period earns these points.*
Examples (your own values will differ):

| Metric | Period | Threshold | Points |
| --- | --- | --- | --- |
| Rebooking % | Weekly | 80 | 100 |
| Revenue Per Ticket | Weekly | 450 | 150 |
| Units Per Hour | Daily | 1.0 | 200 |

- Add **several rules for the same metric and period** to make tiers (e.g. 1,000 → 50 pts and 2,000 → 100 pts). Only the **highest tier reached** counts.
- **Goals:** an achieved goal earns the points of the tier its *target* reaches (employees see the estimate when they create the goal).
- **Streak bonus** (optional, **Settings → Points**): e.g. 100 bonus points every 4th week in a row with at least 4 approved days.

**When are points credited?**
- *Pending*: the day / week / month is still running, or it has entries you haven't reviewed yet.
- *Credited*: once the period is over and every entry in it has been reviewed. This happens automatically.
- Approving yesterday's last entry credits yesterday straight away. Weekly points arrive after the week (Monday–Sunday) ends.

**Changing rules** affects points credited from then on. It never changes points already credited.

---

## 5. Reviewing submissions (your daily routine)

**Submissions** shows the queue, oldest first. Use the tabs (Pending, Needs correction, Rejected, Approved, All),
search by name, and filter by category or dates. Open a submission to see the figures and its full history.

| Button | When to use | What happens |
| --- | --- | --- |
| **Approve** (note optional) | Figures look right | Counts towards the leaderboard, reports and points |
| **Request correction** (reason required) | Something needs fixing | Goes back to the employee, who edits and resubmits |
| **Reject** (reason required) | The entry shouldn't count at all | Locked for the employee, not counted. You can approve it later if needed |
| **Edit values** | A small mistake you can fix yourself | Calculated figures update; your change (old → new value) is recorded in the history |

You can also reopen an approved entry (*Request correction* or *Reject*). If its points were already credited, they
are taken back automatically as a *correction*, and credited again when it's re-approved.

---

## 6. Leaderboard, progress and reports

- **Leaderboard**: rankings per category, by day, week or month (arrows to go back in time). Points come from your
  scoring rules using approved entries. *Overall* compares categories fairly as a percentage of the points available
  in each. You can also **rank by any metric**.
  Employees see their colleagues' ranks, points and goals, but never their colleagues' figures.
- **Employees → chart icon**: one person's performance over time, their trends and their goals.
- **Reports**: team totals, submissions per day, approval and goal-achievement rates, top performers and team averages.
  Filter by dates (up to a year), category and employee.
  **Summary CSV** / **Entries CSV** download a spreadsheet that opens in Excel.

---

## 7. Points (Points page)

- **Balances**: every employee's *available* points, *reserved* points (held for reward requests), *pending*, lifetime and redeemed.
- **Adjust** (slider icon): add points (e.g. `50`) or remove them (`-20`). A **reason is required**. The employee sees it,
  and it's recorded in the audit log. You can't take someone below zero.
- **Transactions**: the complete history, filterable by employee and type. Entries are never edited or deleted.
  Mistakes are fixed with a new transaction.

---

## 8. Rewards and redemptions (Rewards page)

**Catalogue (right):** **Add reward** with a name, description, points price and stock (leave stock empty for unlimited).
Edit any time. Price changes only affect new requests. Untick *Available to employees* to retire a reward.

**Requests (left):**

| Tab | What to do |
| --- | --- |
| **To approve** | **Approve**: points are deducted and stock goes down by one. **Reject** (reason required): the reserved points are released. |
| **To hand over** | Give the employee the reward, then **Mark handed over**. Changed your mind? **Refund** (reason required) returns the points and the stock. |
| **Completed** | History of handed-over, rejected and cancelled requests. |

The system prevents overspending. Points are reserved when an employee asks, an employee can't request the same
reward twice at once, stock is checked, and nobody can redeem more points than they have.

---

## 9. Settings

- **Leaderboard**: show or hide the overall leaderboard for employees.
- **Points**: the points start date and the streak bonus.
- **Employee categories** and **system status**: a quick health check of the configuration.

## 10. Audit log

**Audit log** lists everything important, with who did it and when:
- approvals, rejections and corrections, including old and new values
- points adjustments and reward requests and decisions
- metric, scoring rule, reward and settings changes
- account changes

Filter by type. Nobody (including you) can change or delete entries.

---

## 11. Confirmation popups

Important changes ask you to confirm first, and the popup lists exactly what will happen. **Go back** cancels and keeps what you typed.
You'll see one when you:
- deactivate or reactivate someone, or change their role or category
- reject a submission, reopen an approved one, or overturn a rejection
- save corrected values (the popup lists old → new)
- disable a metric, or change a scoring rule or a reward's price or availability
- adjust points, or change the points or leaderboard settings

Accounts can't be deleted, only deactivated, so their history and points are kept. Deactivating someone also rejects their pending reward requests and releases the points.

---

## 12. Common questions

| Question | Answer |
| --- | --- |
| An employee says their points are missing | Check **Submissions**: points only count once entries are approved and the day/week/month is over. **My Points → Pending** shows what's on the way. |
| An employee left | **Employees → Edit → untick Account active**. Their history and points are kept, and they can no longer sign in. |
| An employee changed role | Change their category. Past entries stay under the old category. |
| I approved something by mistake | Open it and choose **Request correction** or **Reject**. Any points are taken back automatically. |
| Someone's balance is negative | You reopened or edited an approved entry after they had spent its points. The correction is in their history; they earn it back before redeeming again. |
| I gave the wrong number of points | Make another **Adjustment** with the opposite amount and explain why. |
| A reward ran out after I approved it | **Refund** the request (reason required). Points and stock are returned. |
| Someone forgot their password | They use **Forgot password** on the sign-in page. |
