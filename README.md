# Injex Clinics 
A simple, fast, and modern web application built for **Injex Clinics** to track staff daily performance, automate calculations, review submissions, and reward top achievements.

---

## 🎯 What is this project?

This platform replaces daily spreadsheets with an easy-to-use digital portal for clinic staff (**Nurses** and **Beauty Therapists**) and clinic **Administrators**.

It helps clinic owners and practitioners track daily clinic numbers, see who is performing best, and reward hard work with points and prizes.

---

## ✨ Key Features

### 1. Simple Daily Entries
* **Nurses and Beauty Therapists** log their daily shift numbers in under 2 minutes:
  * Hours worked
  * Daily revenue and number of tickets
  * Rebooking rate (%)
  * Treatments performed: **Filler (ml)**, **Sculptra**, **Profhilo**, **Sunekos**, **PRP**, and **PDOs**.

### 2. Automatic Calculations
* No manual math needed. The system instantly calculates:
  * **Hourly Revenue:** Revenue ÷ Hours worked
  * **Revenue Per Ticket:** Revenue ÷ Number of tickets
  * **Mls / Units Per Hour:** Total treatment units ÷ Hours worked

### 3. Admin Verification & Review
* All submitted entries go to the **Admin Review Queue**:
  * **Approve:** Verified results count toward official stats, leaderboards, and points.
  * **Request Correction:** Send back to the employee with a clear note explaining what to fix.
  * **Reject:** Flag incorrect entries with a reason.
  * **Date Selector:** Quickly browse any employee's past submissions by date.

### 4. Leaderboard & Hall of Fame
* **Live Leaderboards:** View daily, weekly, and monthly rankings for Nurses and Beauty Therapists.
* **Team Benchmark:** Compare individual progress against the clinic's average.
* **Hall of Fame:** A spotlight card on top of the leaderboard celebrating the clinic's all-time champion practitioner.

### 5. Points & Rewards Store
* **Earn Points:** Staff earn points automatically when they hit daily/weekly performance targets.
* **Rewards Catalogue:** Staff can spend their points on clinic rewards (vouchers, products, perks).
* **Easy Redemption:** Staff request a reward $\rightarrow$ Admin approves $\rightarrow$ Item is handed over.

---

## 👥 User Roles

| Role | What they can do |
| :--- | :--- |
| **Nurse / Beauty Therapist** | Fill daily entries, view personal progress charts, check leaderboard rank, and redeem rewards with earned points. |
| **Clinic Administrator** | Review and approve submissions, manage staff accounts, set clinic targets, manage the rewards store, and award Hall of Fame champions. |

---

## 🛠 Technology Stack

* **Frontend:** Next.js 16 (App Router), React 19, TypeScript
* **Styling:** Tailwind CSS 4, shadcn/ui components
* **Database & Auth:** Supabase (PostgreSQL with Row Level Security)
* **Emails:** Resend (Fast, reliable password reset emails)
* **Hosting:** Vercel & Supabase Cloud


