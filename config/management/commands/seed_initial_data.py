"""
Management command: python manage.py seed_initial_data

Seeds the database with all initial data needed for a fresh setup:
  - Admin user + team member users
  - Masters (clients, categories, team members)
  - Lead statuses
  - App settings
  - Sample tasks (opt-in via --tasks flag)

Usage:
    python manage.py seed_initial_data            # everything except sample tasks
    python manage.py seed_initial_data --tasks    # also seed 20 sample tasks
    python manage.py seed_initial_data --force    # re-seed even if data exists
    python manage.py seed_initial_data --clear    # wipe tasks first, then seed
"""

import re
from datetime import date, timedelta
from typing import Any

from django.core.management.base import BaseCommand

from core.leads.models import LeadStatus
from core.masters.models import Master
from core.pace.models import PaceGoal
from core.settings_app.models import AppSetting
from core.tasks.models import Task
from users.models import Org, User

# ── Shared constants (mirror frontend/task-tracker/src/data/initialData.ts) ──

CLIENTS = [
    "Focus",
    "Ayyan",
    "ER",
    "Naturefull",
    "Apparel",
    "Zara School",
    "JMS",
    "Mizaj",
    "TAW",
    "Lily Aura",
    "London Stores",
    "Kaaba Grand",
    "Insnap",
    "Al Ameen",
    "The Independent Tobacco FZE",
    "AL-Noor",
    "SS Footwear",
    "Moon Mart",
    "Allied",
    "KSM",
]

CATEGORIES = [
    "Accounting",
    "Audit",
    "Tax",
    "Book Review",
    "Health Check",
    "Database",
    "GST",
    "Payroll",
    "Reconciliation",
    "Other",
]

TEAM_MEMBERS = [
    "Tamil",
    "Musthafa",
    "Akilan",
    "Aravind",
    "Safy",
    "Kasturi",
    "Alavudeen",
    "Surya",
]

# Employees with PACE goals but no task assignments — seeded as users only
PACE_EMPLOYEES = ["Jameel", "Guna", "Vetri"]

AVATAR_COLORS = {
    "Tamil": "#2563eb",
    "Musthafa": "#7c3aed",
    "Akilan": "#16a34a",
    "Aravind": "#d97706",
    "Safy": "#0891b2",
    "Kasturi": "#db2777",
    "Alavudeen": "#dc2626",
    "Surya": "#4f46e5",
}

# Matches DEFAULT_STATUSES in frontend/task-tracker/src/components/LeadsPage.tsx
LEAD_STATUSES = [
    {"name": "Cold", "color": "#64748b", "sort_order": 1},
    {"name": "Warm", "color": "#d97706", "sort_order": 2},
    {"name": "Hot", "color": "#ea580c", "sort_order": 3},
    {"name": "Confirmed", "color": "#16a34a", "sort_order": 4},
    {"name": "Cancelled", "color": "#dc2626", "sort_order": 5},
]

APP_SETTINGS = [
    {"key": "worklog_backdate_days", "value": "7"},
    {"key": "attendance_backdate_days", "value": "7"},
]

# Mirrors updated Task.STATUS_CHOICES (lowercase keys)
INITIAL_TASKS: list[dict[str, Any]] = [
    dict(
        client="Focus",
        category="Accounting",
        description="Database completion",
        status="completed",
        target_date="2026-02-15",
        expected_date="2026-02-15",
        comp_date="2026-02-15",
        responsible="Tamil",
        remarks="Completed on schedule",
        recurrence="onetime",
    ),
    dict(
        client="Ayyan",
        category="Audit",
        description="Internal audit review",
        status="pending",
        target_date="2026-03-01",
        expected_date="2026-03-05",
        comp_date=None,
        responsible="Musthafa",
        remarks="Waiting for client documents",
        recurrence="onetime",
    ),
    dict(
        client="ER",
        category="Tax",
        description="GST submission Q1",
        status="today_task",
        target_date="2026-02-28",
        expected_date="2026-02-28",
        comp_date=None,
        responsible="Akilan",
        remarks="Due today - file by 5pm",
        recurrence="onetime",
    ),
    dict(
        client="Naturefull",
        category="Book Review",
        description="Monthly book closure",
        status="overdue",
        target_date="2026-02-20",
        expected_date="2026-02-25",
        comp_date=None,
        responsible="Aravind",
        remarks="Delayed - client data missing",
        recurrence="monthly",
    ),
    dict(
        client="Apparel",
        category="Health Check",
        description="Financial health assessment",
        status="future_goal",
        target_date="2026-04-15",
        expected_date="2026-04-30",
        comp_date=None,
        responsible="Safy",
        remarks="Planned for Q2 2026",
        recurrence="onetime",
    ),
    dict(
        client="Zara School",
        category="Accounting",
        description="Annual book review completion",
        status="completed_delay",
        target_date="2026-02-10",
        expected_date="2026-02-10",
        comp_date="2026-02-18",
        responsible="Kasturi",
        remarks="Completed 8 days late due to data issues",
        recurrence="yearly",
    ),
    dict(
        client="JMS",
        category="Audit",
        description="Statutory audit preparation",
        status="tbc",
        target_date="2026-03-15",
        expected_date=None,
        comp_date=None,
        responsible="Alavudeen",
        remarks="Awaiting client confirmation on dates",
        recurrence="onetime",
    ),
    dict(
        client="Mizaj",
        category="Tax",
        description="Corporate tax filing",
        status="in_progress",
        target_date="2026-02-28",
        expected_date="2026-02-28",
        comp_date=None,
        responsible="Surya",
        remarks="On track for deadline",
        recurrence="yearly",
    ),
    dict(
        client="TAW",
        category="Payroll",
        description="Payroll processing - February",
        status="pending",
        target_date="2026-03-05",
        expected_date="2026-03-05",
        comp_date=None,
        responsible="Tamil",
        remarks="Waiting for attendance data",
        recurrence="monthly",
    ),
    dict(
        client="Lily Aura",
        category="Book Review",
        description="Q4 2025 book closure",
        status="completed",
        target_date="2026-02-15",
        expected_date="2026-02-15",
        comp_date="2026-02-14",
        responsible="Musthafa",
        remarks="Completed ahead of schedule",
        recurrence="quarterly",
    ),
    dict(
        client="London Stores",
        category="Audit",
        description="External audit support documentation",
        status="today_task",
        target_date="2026-02-28",
        expected_date="2026-02-28",
        comp_date=None,
        responsible="Akilan",
        remarks="Auditor meeting at 3pm today",
        recurrence="onetime",
    ),
    dict(
        client="Kaaba Grand",
        category="Tax",
        description="VAT return filing - Jan 2026",
        status="overdue",
        target_date="2026-02-15",
        expected_date="2026-02-20",
        comp_date=None,
        responsible="Aravind",
        remarks="Pending client invoice list",
        recurrence="monthly",
    ),
    dict(
        client="Insnap",
        category="Reconciliation",
        description="Bank reconciliation - Q4",
        status="future_goal",
        target_date="2026-05-01",
        expected_date="2026-05-15",
        comp_date=None,
        responsible="Safy",
        remarks="Planned after Q1 close",
        recurrence="quarterly",
    ),
    dict(
        client="Al Ameen",
        category="Book Review",
        description="Semi-annual financial review",
        status="tbc",
        target_date="2026-03-31",
        expected_date=None,
        comp_date=None,
        responsible="Kasturi",
        remarks="Client to confirm scope",
        recurrence="quarterly",
    ),
    dict(
        client="KSM",
        category="Health Check",
        description="Business health check report",
        status="in_progress",
        target_date="2026-03-10",
        expected_date="2026-03-10",
        comp_date=None,
        responsible="Alavudeen",
        remarks="Draft report in progress",
        recurrence="onetime",
    ),
    dict(
        client="AL-Noor",
        category="Accounting",
        description="Monthly ledger reconciliation",
        status="completed",
        target_date="2026-02-20",
        expected_date="2026-02-20",
        comp_date="2026-02-19",
        responsible="Surya",
        remarks="Done. No discrepancies.",
        recurrence="monthly",
    ),
    dict(
        client="SS Footwear",
        category="GST",
        description="GST annual return preparation",
        status="pending",
        target_date="2026-03-20",
        expected_date="2026-03-20",
        comp_date=None,
        responsible="Tamil",
        remarks="Collecting invoices from client",
        recurrence="yearly",
    ),
    dict(
        client="Moon Mart",
        category="Audit",
        description="Inventory audit verification",
        status="completed_delay",
        target_date="2026-02-12",
        expected_date="2026-02-12",
        comp_date="2026-02-20",
        responsible="Musthafa",
        remarks="Physical count took longer than expected",
        recurrence="onetime",
    ),
    dict(
        client="Allied",
        category="Tax",
        description="Corporate tax computation FY2025",
        status="pending",
        target_date="2026-03-31",
        expected_date="2026-03-31",
        comp_date=None,
        responsible="Akilan",
        remarks="Pending financials from client",
        recurrence="yearly",
    ),
    dict(
        client="The Independent Tobacco FZE",
        category="Accounting",
        description="Intercompany reconciliation",
        status="today_task",
        target_date="2026-02-28",
        expected_date="2026-02-28",
        comp_date=None,
        responsible="Aravind",
        remarks="Final figures needed today",
        recurrence="monthly",
    ),
]


SEED_GOALS: list[dict] = [
    # ── Alavudeen ────────────────────────────────────────────────────────────
    dict(
        employee_name="Alavudeen",
        goal_type="Result",
        status="Not Started",
        priority="Critical",
        title="Analytics Practice Revenue",
        success_criteria="Generate 1 new analytics client per quarter through business development activities",
        frequency="Quarterly",
        target="Track in BD pipeline",
        tracking_method="",
    ),
    dict(
        employee_name="Alavudeen",
        goal_type="Result",
        status="Not Started",
        priority="Critical",
        title="Team Capability Score",
        success_criteria="Raise average analyst competency rating by 0.5 points across all attributes at next review",
        frequency="45 days",
        target="Measured via competency review",
        tracking_method="",
    ),
    dict(
        employee_name="Alavudeen",
        goal_type="Result",
        status="Not Started",
        priority="Critical",
        title="Zero Delivery Defects",
        success_criteria="Maintain 100% dashboard accuracy with zero post-delivery corrections for all clients",
        frequency="Monthly",
        target="Error log: 0 corrections",
        tracking_method="",
    ),
    dict(
        employee_name="Alavudeen",
        goal_type="Result",
        status="Not Started",
        priority="Critical",
        title="Data Governance Framework",
        success_criteria="Implement a basic data governance checklist for all new client onboardings",
        frequency="45 days",
        target="Checklist used for 100% of new projects",
        tracking_method="",
    ),
    dict(
        employee_name="Alavudeen",
        goal_type="Result",
        status="Not Started",
        priority="Critical",
        title="Stakeholder Presentation",
        success_criteria="Present analytics insights to CXO-level stakeholder for minimum 2 clients per quarter",
        frequency="Quarterly",
        target="Presentations documented",
        tracking_method="",
    ),
    dict(
        employee_name="Alavudeen",
        goal_type="Skill",
        status="Not Started",
        priority="Critical",
        title="Data Strategy & Governance",
        current_rating=2.5,
        target_rating=4.0,
        learning_action="Study DAMA-DMBOK framework; implement data quality checklist across all client projects",
        completion_by="45 Days",
    ),
    dict(
        employee_name="Alavudeen",
        goal_type="Skill",
        status="Not Started",
        priority="Critical",
        title="Project Management",
        current_rating=2.5,
        target_rating=4.0,
        learning_action="Learn Agile/Scrum basics; apply sprint planning to 1 client project; track via Trello or similar tool",
        completion_by="45 Days",
    ),
    dict(
        employee_name="Alavudeen",
        goal_type="Skill",
        status="Not Started",
        priority="Critical",
        title="Financial & Business Acumen",
        current_rating=2.5,
        target_rating=4.0,
        learning_action="Study unit economics & P&L basics; present ROI analysis for 1 analytics engagement per quarter",
        completion_by="45 Days",
    ),
    dict(
        employee_name="Alavudeen",
        goal_type="Skill",
        status="Not Started",
        priority="Critical",
        title="Marketing & Sales Principles",
        current_rating=2.5,
        target_rating=4.0,
        learning_action="Co-develop 1 case study per month; participate in 1 sales pitch presentation per quarter",
        completion_by="45 Days",
    ),
    dict(
        employee_name="Alavudeen",
        goal_type="Skill",
        status="Not Started",
        priority="Critical",
        title="Stakeholder Communication",
        current_rating=3.0,
        target_rating=4.0,
        learning_action="Lead 2 CXO-level presentations per quarter; translate all insights into business language (no jargon)",
        completion_by="45 Days",
    ),
    dict(
        employee_name="Alavudeen",
        goal_type="Skill",
        status="Not Started",
        priority="Critical",
        title="Industry Benchmarks & Trends",
        current_rating=2.5,
        target_rating=4.0,
        learning_action="Read 1 analytics industry report per month; share 2 trend insights in team meeting monthly",
        completion_by="45 Days",
    ),
    dict(
        employee_name="Alavudeen",
        goal_type="Attitude",
        status="Not Started",
        priority="Critical",
        title="Ownership & Accountability",
        iceberg_level="Trait",
        current_rating=5.0,
        focus_area="Sustain & Model",
        daily_practice="Continue owning all outcomes; coach team members to adopt same ownership mindset in their own work",
    ),
    dict(
        employee_name="Alavudeen",
        goal_type="Attitude",
        status="Not Started",
        priority="Critical",
        title="Building a Scalable Analytics Business",
        iceberg_level="Motive",
        current_rating=5.0,
        focus_area="Sustain & Expand",
        daily_practice="Document analytics practice SOPs; set quarterly growth targets for the practice; present vision to leadership",
    ),
    dict(
        employee_name="Alavudeen",
        goal_type="Attitude",
        status="Not Started",
        priority="Critical",
        title="Stakeholder Empathy",
        iceberg_level="Trait",
        current_rating=4.5,
        focus_area="Channel into BD",
        daily_practice="Use client empathy to identify upsell opportunities; document client business challenges and propose analytics solutions",
    ),
    dict(
        employee_name="Alavudeen",
        goal_type="Attitude",
        status="Not Started",
        priority="Critical",
        title="Decisiveness Under Ambiguity",
        iceberg_level="Trait",
        current_rating=4.0,
        focus_area="Sustain",
        daily_practice="Document key decisions made under ambiguity; share learnings with team to build their decision-making confidence",
    ),
    dict(
        employee_name="Alavudeen",
        goal_type="Attitude",
        status="Not Started",
        priority="Critical",
        title="Leadership Legacy",
        iceberg_level="Motive",
        current_rating=5.0,
        focus_area="Activate Intentionally",
        daily_practice="Identify 1 analyst to develop as a 'junior manager'; create their 45-day development plan this week",
    ),
    # ── Tamil ────────────────────────────────────────────────────────────────
    dict(
        employee_name="Tamil",
        goal_type="Result",
        status="Not Started",
        priority="Critical",
        title="Analytics Practice Revenue",
        success_criteria="Generate 1 new analytics client per quarter through business development activities",
        frequency="Quarterly",
        target="Track in BD pipeline",
        tracking_method="",
    ),
    dict(
        employee_name="Tamil",
        goal_type="Result",
        status="Not Started",
        priority="Critical",
        title="Team Capability Score",
        success_criteria="Raise average analyst competency rating by 0.5 points across all attributes at next review",
        frequency="45 days",
        target="Measured via competency review",
        tracking_method="",
    ),
    dict(
        employee_name="Tamil",
        goal_type="Result",
        status="Not Started",
        priority="Critical",
        title="Zero Delivery Defects",
        success_criteria="Maintain 100% dashboard accuracy with zero post-delivery corrections for all clients",
        frequency="Monthly",
        target="Error log: 0 corrections",
        tracking_method="",
    ),
    dict(
        employee_name="Tamil",
        goal_type="Result",
        status="Not Started",
        priority="Critical",
        title="Data Governance Framework",
        success_criteria="Implement a basic data governance checklist for all new client onboardings",
        frequency="45 days",
        target="Checklist used for 100% of new projects",
        tracking_method="",
    ),
    dict(
        employee_name="Tamil",
        goal_type="Result",
        status="Not Started",
        priority="Critical",
        title="Stakeholder Presentation",
        success_criteria="Present analytics insights to CXO-level stakeholder for minimum 2 clients per quarter",
        frequency="Quarterly",
        target="Presentations documented",
        tracking_method="",
    ),
    dict(
        employee_name="Tamil",
        goal_type="Skill",
        status="Not Started",
        priority="Critical",
        title="Data Strategy & Governance",
        current_rating=2.5,
        target_rating=4.0,
        learning_action="Study DAMA-DMBOK framework; implement data quality checklist across all client projects",
        completion_by="45 Days",
    ),
    dict(
        employee_name="Tamil",
        goal_type="Skill",
        status="Not Started",
        priority="Critical",
        title="Project Management",
        current_rating=2.5,
        target_rating=4.0,
        learning_action="Learn Agile/Scrum basics; apply sprint planning to 1 client project; track via Trello or similar tool",
        completion_by="45 Days",
    ),
    dict(
        employee_name="Tamil",
        goal_type="Skill",
        status="Not Started",
        priority="Critical",
        title="Financial & Business Acumen",
        current_rating=2.5,
        target_rating=4.0,
        learning_action="Study unit economics & P&L basics; present ROI analysis for 1 analytics engagement per quarter",
        completion_by="45 Days",
    ),
    dict(
        employee_name="Tamil",
        goal_type="Skill",
        status="Not Started",
        priority="Critical",
        title="Marketing & Sales Principles",
        current_rating=2.5,
        target_rating=4.0,
        learning_action="Co-develop 1 case study per month; participate in 1 sales pitch presentation per quarter",
        completion_by="45 Days",
    ),
    dict(
        employee_name="Tamil",
        goal_type="Skill",
        status="Not Started",
        priority="Critical",
        title="Stakeholder Communication",
        current_rating=3.0,
        target_rating=4.0,
        learning_action="Lead 2 CXO-level presentations per quarter; translate all insights into business language (no jargon)",
        completion_by="45 Days",
    ),
    dict(
        employee_name="Tamil",
        goal_type="Skill",
        status="Not Started",
        priority="Critical",
        title="Industry Benchmarks & Trends",
        current_rating=2.5,
        target_rating=4.0,
        learning_action="Read 1 analytics industry report per month; share 2 trend insights in team meeting monthly",
        completion_by="45 Days",
    ),
    dict(
        employee_name="Tamil",
        goal_type="Attitude",
        status="Not Started",
        priority="Critical",
        title="Ownership & Accountability",
        iceberg_level="Trait",
        current_rating=5.0,
        focus_area="Sustain & Model",
        daily_practice="Continue owning all outcomes; coach team members to adopt same ownership mindset in their own work",
    ),
    dict(
        employee_name="Tamil",
        goal_type="Attitude",
        status="Not Started",
        priority="Critical",
        title="Building a Scalable Analytics Business",
        iceberg_level="Motive",
        current_rating=5.0,
        focus_area="Sustain & Expand",
        daily_practice="Document analytics practice SOPs; set quarterly growth targets for the practice; present vision to leadership",
    ),
    dict(
        employee_name="Tamil",
        goal_type="Attitude",
        status="Not Started",
        priority="Critical",
        title="Stakeholder Empathy",
        iceberg_level="Trait",
        current_rating=4.5,
        focus_area="Channel into BD",
        daily_practice="Use client empathy to identify upsell opportunities; document client business challenges and propose analytics solutions",
    ),
    dict(
        employee_name="Tamil",
        goal_type="Attitude",
        status="Not Started",
        priority="Critical",
        title="Decisiveness Under Ambiguity",
        iceberg_level="Trait",
        current_rating=4.0,
        focus_area="Sustain",
        daily_practice="Document key decisions made under ambiguity; share learnings with team to build their decision-making confidence",
    ),
    dict(
        employee_name="Tamil",
        goal_type="Attitude",
        status="Not Started",
        priority="Critical",
        title="Leadership Legacy",
        iceberg_level="Motive",
        current_rating=5.0,
        focus_area="Activate Intentionally",
        daily_practice="Identify 1 analyst to develop as a 'junior manager'; create their 45-day development plan this week",
    ),
    # ── Akilan ───────────────────────────────────────────────────────────────
    dict(
        employee_name="Akilan",
        goal_type="Result",
        status="Not Started",
        priority="Critical",
        title="100% On-Time Delivery",
        success_criteria="All audit & dashboard deliverables delivered by committed deadlines",
        frequency="Monthly",
        target="Target: 0 delayed submissions",
        tracking_method="",
    ),
    dict(
        employee_name="Akilan",
        goal_type="Result",
        status="Not Started",
        priority="Critical",
        title="Zero Client Escalations",
        success_criteria="Resolve all client issues within 24 hrs; maintain 9+/10 satisfaction",
        frequency="Monthly",
        target="Track via client feedback form",
        tracking_method="",
    ),
    dict(
        employee_name="Akilan",
        goal_type="Result",
        status="Not Started",
        priority="Critical",
        title="Team Review Completion",
        success_criteria="Conduct fortnightly reviews for all direct reports with documented feedback",
        frequency="Fortnightly",
        target="100% review sessions held",
        tracking_method="",
    ),
    dict(
        employee_name="Akilan",
        goal_type="Result",
        status="Not Started",
        priority="Critical",
        title="Revenue Contribution",
        success_criteria="Generate 2 new client leads or upsell opportunities per quarter through analytics practice",
        frequency="Quarterly",
        target="Leads tracked in CRM",
        tracking_method="",
    ),
    dict(
        employee_name="Akilan",
        goal_type="Result",
        status="Not Started",
        priority="Critical",
        title="Power BI Skill Upgrade",
        success_criteria="Achieve proficiency in Power BI Premium & Azure (rating: 1 → 3+ by next review)",
        frequency="45 days",
        target="Assessed by Manager Analyst benchmark",
        tracking_method="",
    ),
    dict(
        employee_name="Akilan",
        goal_type="Skill",
        status="Not Started",
        priority="Critical",
        title="Expert-Level Power BI (Mgr Analyst)",
        current_rating=2.0,
        target_rating=3.0,
        learning_action="Complete Microsoft Power BI Advanced certification; build 2 enterprise-level dashboards",
        completion_by="45 Days",
    ),
    dict(
        employee_name="Akilan",
        goal_type="Skill",
        status="Not Started",
        priority="Critical",
        title="Advanced Power BI & Azure (Mgr Analyst)",
        current_rating=1.0,
        target_rating=3.0,
        learning_action="Study Fabric/Azure Data Lake; complete 2 hands-on labs on Dataflows & Synapse",
        completion_by="45 Days",
    ),
    dict(
        employee_name="Akilan",
        goal_type="Skill",
        status="Not Started",
        priority="Critical",
        title="Team Leadership & Mentoring (Mgr Analyst)",
        current_rating=2.0,
        target_rating=4.0,
        learning_action="Conduct weekly 1-on-1 with each analyst; document mentoring outcomes",
        completion_by="45 Days",
    ),
    dict(
        employee_name="Akilan",
        goal_type="Skill",
        status="Not Started",
        priority="Critical",
        title="Client Meeting & Communication (Audit Mgr)",
        current_rating=3.0,
        target_rating=4.0,
        learning_action="Lead all client meetings; prepare structured agendas; post-meeting MOM within 2 hrs",
        completion_by="45 Days",
    ),
    dict(
        employee_name="Akilan",
        goal_type="Skill",
        status="Not Started",
        priority="Critical",
        title="Assertiveness (Trait)",
        current_rating=2.0,
        target_rating=3.0,
        learning_action="Practice clear expectation-setting with team daily; use 'I' statements in client communications",
        completion_by="45 Days",
    ),
    dict(
        employee_name="Akilan",
        goal_type="Skill",
        status="Not Started",
        priority="Critical",
        title="MIS & Reporting (Audit Mgr)",
        current_rating=3.5,
        target_rating=4.0,
        learning_action="Design 1 new executive MIS dashboard per month; present findings in strategic meetings",
        completion_by="45 Days",
    ),
    dict(
        employee_name="Akilan",
        goal_type="Attitude",
        status="Not Started",
        priority="Critical",
        title="Assertiveness",
        iceberg_level="Trait",
        current_rating=2.0,
        focus_area="Practice",
        daily_practice="State expectations clearly at start of every meeting; give direct feedback without hedging",
    ),
    dict(
        employee_name="Akilan",
        goal_type="Attitude",
        status="Not Started",
        priority="Critical",
        title="Proactiveness",
        iceberg_level="Trait",
        current_rating=2.0,
        focus_area="Build Habit",
        daily_practice="Identify 1 potential problem each week before it arises; brief team proactively every Monday",
    ),
    dict(
        employee_name="Akilan",
        goal_type="Attitude",
        status="Not Started",
        priority="Critical",
        title="Trusted Client Advisor",
        iceberg_level="Self-Image",
        current_rating=3.0,
        focus_area="Strengthen",
        daily_practice="Share one proactive insight per client per month beyond what was asked; reframe role as advisor not executor",
    ),
    dict(
        employee_name="Akilan",
        goal_type="Attitude",
        status="Not Started",
        priority="Critical",
        title="Ownership & Accountability",
        iceberg_level="Trait",
        current_rating=3.0,
        focus_area="Deepen",
        daily_practice="Own team failures without blame-shifting; declare 'I own this' on every escalation",
    ),
    dict(
        employee_name="Akilan",
        goal_type="Attitude",
        status="Not Started",
        priority="Critical",
        title="Strategic Thinking",
        iceberg_level="Trait",
        current_rating=3.0,
        focus_area="Develop",
        daily_practice="Dedicate 30 min/week to reading industry trends; present 1 strategic idea per strategic review meeting",
    ),
    # ── Musthafa ─────────────────────────────────────────────────────────────
    dict(
        employee_name="Musthafa",
        goal_type="Result",
        status="Not Started",
        priority="Critical",
        title="100% GST Reconciliation Accuracy",
        success_criteria="Zero mismatches in GSTR-1 vs GSTR-2A/2B reconciliation after final review",
        frequency="Monthly",
        target="Track error count per client",
        tracking_method="",
    ),
    dict(
        employee_name="Musthafa",
        goal_type="Result",
        status="Not Started",
        priority="Critical",
        title="TDS Filing On Time",
        success_criteria="All TDS returns filed by due date with zero penalty notices",
        frequency="Quarterly",
        target="0 late filings",
        tracking_method="",
    ),
    dict(
        employee_name="Musthafa",
        goal_type="Result",
        status="Not Started",
        priority="Critical",
        title="Excel-Based Automation",
        success_criteria="Build 2 reusable Excel templates (reconciliation/TDS) to reduce manual time by 30%",
        frequency="45 days",
        target="Templates documented & shared",
        tracking_method="",
    ),
    dict(
        employee_name="Musthafa",
        goal_type="Result",
        status="Not Started",
        priority="Critical",
        title="Zero Booking Errors",
        success_criteria="Error detection: < 2 wrong booking instances per month across all clients",
        frequency="Monthly",
        target="Error log reviewed by manager",
        tracking_method="",
    ),
    dict(
        employee_name="Musthafa",
        goal_type="Result",
        status="Not Started",
        priority="Critical",
        title="Compliance Calendar Adherence",
        success_criteria="100% adherence to statutory due-date tracker for all assigned clients",
        frequency="Monthly",
        target="Calendar completion rate tracked",
        tracking_method="",
    ),
    dict(
        employee_name="Musthafa",
        goal_type="Skill",
        status="Not Started",
        priority="Critical",
        title="Excel & Data Management",
        current_rating=1.0,
        target_rating=3.0,
        learning_action="Complete Excel advanced course (VLOOKUP, Pivot, SUMIF); build reconciliation template in Excel within 2 weeks",
        completion_by="45 Days",
    ),
    dict(
        employee_name="Musthafa",
        goal_type="Skill",
        status="Not Started",
        priority="Critical",
        title="Industry-Specific Regulations",
        current_rating=2.0,
        target_rating=3.0,
        learning_action="Study 2 client industry profiles per month; document key regulatory differences",
        completion_by="45 Days",
    ),
    dict(
        employee_name="Musthafa",
        goal_type="Skill",
        status="Not Started",
        priority="Critical",
        title="Audit Documentation",
        current_rating=3.0,
        target_rating=4.0,
        learning_action="Use standardized working paper templates for every client; review documentation checklist before submission",
        completion_by="45 Days",
    ),
    dict(
        employee_name="Musthafa",
        goal_type="Skill",
        status="Not Started",
        priority="Critical",
        title="Accounting Standards",
        current_rating=3.0,
        target_rating=4.0,
        learning_action="Study 2 Accounting Standards per month; apply concepts to real client scenarios",
        completion_by="45 Days",
    ),
    dict(
        employee_name="Musthafa",
        goal_type="Skill",
        status="Not Started",
        priority="Critical",
        title="Patience (Trait)",
        current_rating=2.0,
        target_rating=3.0,
        learning_action="Practice working through 1 complex reconciliation fully before seeking help; set time-blocks for deep work",
        completion_by="45 Days",
    ),
    dict(
        employee_name="Musthafa",
        goal_type="Skill",
        status="Not Started",
        priority="Critical",
        title="Audit Procedures",
        current_rating=3.0,
        target_rating=4.0,
        learning_action="Shadow senior on audit process; apply vouching/verification steps independently for 2 clients",
        completion_by="45 Days",
    ),
    dict(
        employee_name="Musthafa",
        goal_type="Attitude",
        status="Not Started",
        priority="Critical",
        title="Patience",
        iceberg_level="Trait",
        current_rating=2.0,
        focus_area="Build Habit",
        daily_practice="Commit to completing full reconciliation cycle before escalating; block 2-hour deep-work sessions daily",
    ),
    dict(
        employee_name="Musthafa",
        goal_type="Attitude",
        status="Not Started",
        priority="Critical",
        title="Meticulousness",
        iceberg_level="Trait",
        current_rating=3.0,
        focus_area="Strengthen",
        daily_practice="Use a pre-submission checklist for every reconciliation; verify 3 key totals before finalizing",
    ),
    dict(
        employee_name="Musthafa",
        goal_type="Attitude",
        status="Not Started",
        priority="Critical",
        title="Detail-Oriented Professional",
        iceberg_level="Self-Image",
        current_rating=3.0,
        focus_area="Strengthen",
        daily_practice="Say aloud: 'I catch what others miss.' Review 1 past error weekly to reinforce thoroughness mindset",
    ),
    dict(
        employee_name="Musthafa",
        goal_type="Attitude",
        status="Not Started",
        priority="Critical",
        title="Discipline",
        iceberg_level="Trait",
        current_rating=3.0,
        focus_area="Deepen",
        daily_practice="Follow daily task checklist; update client tracker by EOD every day",
    ),
    dict(
        employee_name="Musthafa",
        goal_type="Attitude",
        status="Not Started",
        priority="Critical",
        title="Analytical Thinking",
        iceberg_level="Trait",
        current_rating=3.0,
        focus_area="Develop",
        daily_practice="For every discrepancy: write down the root cause before correcting it; build root-cause habit",
    ),
    # ── Surya ────────────────────────────────────────────────────────────────
    dict(
        employee_name="Surya",
        goal_type="Result",
        status="Not Started",
        priority="Critical",
        title="Data Entry Accuracy",
        success_criteria="Zero data entry errors in assigned client books per month (after self-review)",
        frequency="Monthly",
        target="Error count tracked by senior",
        tracking_method="",
    ),
    dict(
        employee_name="Surya",
        goal_type="Result",
        status="Not Started",
        priority="Critical",
        title="Bank Reconciliation Drafts",
        success_criteria="Complete BRS draft for all assigned clients by 5th of each month",
        frequency="Monthly",
        target="100% on-time submission",
        tracking_method="",
    ),
    dict(
        employee_name="Surya",
        goal_type="Result",
        status="Not Started",
        priority="Critical",
        title="GST Data Preparation",
        success_criteria="Submit GST input sheets with complete & verified data before senior's deadline",
        frequency="Monthly",
        target="Zero incomplete submissions",
        tracking_method="",
    ),
    dict(
        employee_name="Surya",
        goal_type="Result",
        status="Not Started",
        priority="Critical",
        title="TDS Knowledge Application",
        success_criteria="Correctly identify TDS section & rate for 90%+ of vendor transactions assigned",
        frequency="Monthly",
        target="Checked by senior before filing",
        tracking_method="",
    ),
    dict(
        employee_name="Surya",
        goal_type="Result",
        status="Not Started",
        priority="Critical",
        title="Accounting Standards Awareness",
        success_criteria="Complete study of 3 core accounting standards and explain concepts correctly when asked",
        frequency="45 days",
        target="Quiz by manager at next review",
        tracking_method="",
    ),
    dict(
        employee_name="Surya",
        goal_type="Skill",
        status="Not Started",
        priority="Critical",
        title="Accounting Standards – Basics",
        current_rating=1.0,
        target_rating=2.0,
        learning_action="Study going concern, accrual, matching principle; write 1-page summary for each; present to senior",
        completion_by="45 Days",
    ),
    dict(
        employee_name="Surya",
        goal_type="Skill",
        status="Not Started",
        priority="Critical",
        title="Basic TDS Concepts",
        current_rating=2.0,
        target_rating=3.0,
        learning_action="Study TDS sections 194A, 192, 194C, 194J, 194T; practice identifying applicable section for 20 real transactions",
        completion_by="45 Days",
    ),
    dict(
        employee_name="Surya",
        goal_type="Skill",
        status="Not Started",
        priority="Critical",
        title="Basic GST Concepts",
        current_rating=2.5,
        target_rating=3.0,
        learning_action="Complete GST basics module; practice GSTR-2A reconciliation under senior supervision for 3 clients",
        completion_by="45 Days",
    ),
    dict(
        employee_name="Surya",
        goal_type="Skill",
        status="Not Started",
        priority="Critical",
        title="Excel – Intermediate Level",
        current_rating=3.0,
        target_rating=4.0,
        learning_action="Practice VLOOKUP, SUMIF, Pivot Tables daily; build one reconciliation sheet independently each week",
        completion_by="45 Days",
    ),
    dict(
        employee_name="Surya",
        goal_type="Skill",
        status="Not Started",
        priority="Critical",
        title="Bank Reconciliation Support",
        current_rating=3.0,
        target_rating=4.0,
        learning_action="Complete BRS draft independently for 2 clients per month; reduce senior review corrections to zero",
        completion_by="45 Days",
    ),
    dict(
        employee_name="Surya",
        goal_type="Skill",
        status="Not Started",
        priority="Critical",
        title="Detail-Conscious Worker (Self-Image)",
        current_rating=2.5,
        target_rating=3.0,
        learning_action="Use self-review checklist before every submission; track and reduce repeat errors to zero",
        completion_by="45 Days",
    ),
    dict(
        employee_name="Surya",
        goal_type="Attitude",
        status="Not Started",
        priority="Critical",
        title="Detail-Conscious Worker",
        iceberg_level="Self-Image",
        current_rating=2.5,
        focus_area="Strengthen",
        daily_practice="Before submitting any work, verbally affirm: 'I check everything twice.' Use submission checklist every time",
    ),
    dict(
        employee_name="Surya",
        goal_type="Attitude",
        status="Not Started",
        priority="Critical",
        title="Willingness to Learn",
        iceberg_level="Trait",
        current_rating=3.5,
        focus_area="Deepen",
        daily_practice="Ask 1 'why' question to senior every day about a process; maintain a 'learnings journal' updated daily",
    ),
    dict(
        employee_name="Surya",
        goal_type="Attitude",
        status="Not Started",
        priority="Critical",
        title="Attention to Detail",
        iceberg_level="Trait",
        current_rating=3.0,
        focus_area="Strengthen",
        daily_practice="Self-review all entries against source documents before submission; aim for zero corrections from senior",
    ),
    dict(
        employee_name="Surya",
        goal_type="Attitude",
        status="Not Started",
        priority="Critical",
        title="Earning Trust & Responsibility",
        iceberg_level="Motive",
        current_rating=4.0,
        focus_area="Channel",
        daily_practice="Express desire for more responsibility to senior; volunteer for one additional task per week beyond assigned work",
    ),
    dict(
        employee_name="Surya",
        goal_type="Attitude",
        status="Not Started",
        priority="Critical",
        title="Eager Learner",
        iceberg_level="Self-Image",
        current_rating=3.0,
        focus_area="Strengthen",
        daily_practice="Create a daily learning goal (1 concept per day); track progress in learning journal",
    ),
    # ── Jameel ───────────────────────────────────────────────────────────────
    dict(
        employee_name="Jameel",
        goal_type="Result",
        status="Not Started",
        priority="Critical",
        title="Data Entry Accuracy",
        success_criteria="Zero data entry errors in assigned client books per month (after self-review)",
        frequency="Monthly",
        target="Error count tracked by senior",
        tracking_method="",
    ),
    dict(
        employee_name="Jameel",
        goal_type="Result",
        status="Not Started",
        priority="Critical",
        title="Bank Reconciliation Drafts",
        success_criteria="Complete BRS draft for all assigned clients by 5th of each month",
        frequency="Monthly",
        target="100% on-time submission",
        tracking_method="",
    ),
    dict(
        employee_name="Jameel",
        goal_type="Result",
        status="Not Started",
        priority="Critical",
        title="GST Data Preparation",
        success_criteria="Submit GST input sheets with complete & verified data before senior's deadline",
        frequency="Monthly",
        target="Zero incomplete submissions",
        tracking_method="",
    ),
    dict(
        employee_name="Jameel",
        goal_type="Result",
        status="Not Started",
        priority="Critical",
        title="TDS Knowledge Application",
        success_criteria="Correctly identify TDS section & rate for 90%+ of vendor transactions assigned",
        frequency="Monthly",
        target="Checked by senior before filing",
        tracking_method="",
    ),
    dict(
        employee_name="Jameel",
        goal_type="Result",
        status="Not Started",
        priority="Critical",
        title="Accounting Standards Awareness",
        success_criteria="Complete study of 3 core accounting standards and explain concepts correctly when asked",
        frequency="45 days",
        target="Quiz by manager at next review",
        tracking_method="",
    ),
    dict(
        employee_name="Jameel",
        goal_type="Skill",
        status="Not Started",
        priority="Critical",
        title="Accounting Standards – Basics",
        current_rating=1.0,
        target_rating=2.0,
        learning_action="Study going concern, accrual, matching principle; write 1-page summary for each; present to senior",
        completion_by="45 Days",
    ),
    dict(
        employee_name="Jameel",
        goal_type="Skill",
        status="Not Started",
        priority="Critical",
        title="Basic TDS Concepts",
        current_rating=2.0,
        target_rating=3.0,
        learning_action="Study TDS sections 194A, 192, 194C, 194J, 194T; practice identifying applicable section for 20 real transactions",
        completion_by="45 Days",
    ),
    dict(
        employee_name="Jameel",
        goal_type="Skill",
        status="Not Started",
        priority="Critical",
        title="Basic GST Concepts",
        current_rating=2.5,
        target_rating=3.0,
        learning_action="Complete GST basics module; practice GSTR-2A reconciliation under senior supervision for 3 clients",
        completion_by="45 Days",
    ),
    dict(
        employee_name="Jameel",
        goal_type="Skill",
        status="Not Started",
        priority="Critical",
        title="Excel – Intermediate Level",
        current_rating=3.0,
        target_rating=4.0,
        learning_action="Practice VLOOKUP, SUMIF, Pivot Tables daily; build one reconciliation sheet independently each week",
        completion_by="45 Days",
    ),
    dict(
        employee_name="Jameel",
        goal_type="Skill",
        status="Not Started",
        priority="Critical",
        title="Bank Reconciliation Support",
        current_rating=3.0,
        target_rating=4.0,
        learning_action="Complete BRS draft independently for 2 clients per month; reduce senior review corrections to zero",
        completion_by="45 Days",
    ),
    dict(
        employee_name="Jameel",
        goal_type="Skill",
        status="Not Started",
        priority="Critical",
        title="Detail-Conscious Worker (Self-Image)",
        current_rating=2.5,
        target_rating=3.0,
        learning_action="Use self-review checklist before every submission; track and reduce repeat errors to zero",
        completion_by="45 Days",
    ),
    dict(
        employee_name="Jameel",
        goal_type="Attitude",
        status="Not Started",
        priority="Critical",
        title="Detail-Conscious Worker",
        iceberg_level="Self-Image",
        current_rating=2.5,
        focus_area="Strengthen",
        daily_practice="Before submitting any work, verbally affirm: 'I check everything twice.' Use submission checklist every time",
    ),
    dict(
        employee_name="Jameel",
        goal_type="Attitude",
        status="Not Started",
        priority="Critical",
        title="Willingness to Learn",
        iceberg_level="Trait",
        current_rating=3.5,
        focus_area="Deepen",
        daily_practice="Ask 1 'why' question to senior every day about a process; maintain a 'learnings journal' updated daily",
    ),
    dict(
        employee_name="Jameel",
        goal_type="Attitude",
        status="Not Started",
        priority="Critical",
        title="Attention to Detail",
        iceberg_level="Trait",
        current_rating=3.0,
        focus_area="Strengthen",
        daily_practice="Self-review all entries against source documents before submission; aim for zero corrections from senior",
    ),
    dict(
        employee_name="Jameel",
        goal_type="Attitude",
        status="Not Started",
        priority="Critical",
        title="Earning Trust & Responsibility",
        iceberg_level="Motive",
        current_rating=4.0,
        focus_area="Channel",
        daily_practice="Express desire for more responsibility to senior; volunteer for one additional task per week beyond assigned work",
    ),
    dict(
        employee_name="Jameel",
        goal_type="Attitude",
        status="Not Started",
        priority="Critical",
        title="Eager Learner",
        iceberg_level="Self-Image",
        current_rating=3.0,
        focus_area="Strengthen",
        daily_practice="Create a daily learning goal (1 concept per day); track progress in learning journal",
    ),
    # ── Guna ─────────────────────────────────────────────────────────────────
    dict(
        employee_name="Guna",
        goal_type="Result",
        status="Not Started",
        priority="Critical",
        title="Dashboard Delivery On Time",
        success_criteria="Deliver all assigned dashboards by committed date with zero rework requests",
        frequency="Monthly",
        target="Track delivery vs. deadline",
        tracking_method="",
    ),
    dict(
        employee_name="Guna",
        goal_type="Result",
        status="Not Started",
        priority="Critical",
        title="Power BI Ecosystem Knowledge",
        success_criteria="Understand Power BI Service, gateways, RLS, and scheduled refresh (rating: 1 → 3)",
        frequency="45 days",
        target="Assessed by Manager Analyst",
        tracking_method="",
    ),
    dict(
        employee_name="Guna",
        goal_type="Result",
        status="Not Started",
        priority="Critical",
        title="DAX Measure Accuracy",
        success_criteria="Zero incorrect DAX calculations in dashboards after self-testing",
        frequency="Monthly",
        target="Verified by manager review",
        tracking_method="",
    ),
    dict(
        employee_name="Guna",
        goal_type="Result",
        status="Not Started",
        priority="Critical",
        title="Self-Learning Targets",
        success_criteria="Complete 1 Power BI course module per week and document key learnings",
        frequency="Weekly",
        target="Learning log submitted every Friday",
        tracking_method="",
    ),
    dict(
        employee_name="Guna",
        goal_type="Result",
        status="Not Started",
        priority="Critical",
        title="Business Domain Understanding",
        success_criteria="Map and document KPIs for 2 client domains independently",
        frequency="45 days",
        target="Document reviewed by manager",
        tracking_method="",
    ),
    dict(
        employee_name="Guna",
        goal_type="Skill",
        status="Not Started",
        priority="Critical",
        title="Power BI Ecosystem (Service/Gateway/RLS)",
        current_rating=1.0,
        target_rating=3.0,
        learning_action="Complete Microsoft Learn: Power BI Service module; set up practice workspace with RLS and scheduled refresh",
        completion_by="45 Days",
    ),
    dict(
        employee_name="Guna",
        goal_type="Skill",
        status="Not Started",
        priority="Critical",
        title="Data Warehousing Concepts",
        current_rating=1.0,
        target_rating=2.0,
        learning_action="Study ETL basics, fact vs dimension tables; draw data model for 1 existing client dashboard",
        completion_by="45 Days",
    ),
    dict(
        employee_name="Guna",
        goal_type="Skill",
        status="Not Started",
        priority="Critical",
        title="Statistics & Analytics Fundamentals",
        current_rating=1.0,
        target_rating=2.0,
        learning_action="Complete basic statistics module; apply averages, trend lines, and variance analysis in next dashboard",
        completion_by="45 Days",
    ),
    dict(
        employee_name="Guna",
        goal_type="Skill",
        status="Not Started",
        priority="Critical",
        title="Visualization Best Practices",
        current_rating=2.0,
        target_rating=3.0,
        learning_action="Study 'Storytelling with Data' principles; audit 2 existing dashboards and improve visual selection",
        completion_by="45 Days",
    ),
    dict(
        employee_name="Guna",
        goal_type="Skill",
        status="Not Started",
        priority="Critical",
        title="SQL Querying",
        current_rating=2.5,
        target_rating=3.0,
        learning_action="Complete SQL basics course; write 10 practice queries against client data with manager review",
        completion_by="45 Days",
    ),
    dict(
        employee_name="Guna",
        goal_type="Skill",
        status="Not Started",
        priority="Critical",
        title="Business Domain Understanding",
        current_rating=2.0,
        target_rating=3.0,
        learning_action="Study 2 client industry profiles; list 5 key KPIs per domain and explain purpose to manager",
        completion_by="45 Days",
    ),
    dict(
        employee_name="Guna",
        goal_type="Attitude",
        status="Not Started",
        priority="Critical",
        title="Self-Driven Learning",
        iceberg_level="Trait",
        current_rating=1.0,
        focus_area="Build Urgently",
        daily_practice="Commit to 45 min of self-study every day without being reminded; log progress in daily learning tracker",
    ),
    dict(
        employee_name="Guna",
        goal_type="Attitude",
        status="Not Started",
        priority="Critical",
        title="Logical Thinking",
        iceberg_level="Trait",
        current_rating=1.0,
        focus_area="Build Urgently",
        daily_practice="Before building any measure, write out the logic in plain English; ask 'does this make business sense?'",
    ),
    dict(
        employee_name="Guna",
        goal_type="Attitude",
        status="Not Started",
        priority="Critical",
        title="Patience with Data",
        iceberg_level="Trait",
        current_rating=1.0,
        focus_area="Build Habit",
        daily_practice="Work through messy datasets for minimum 30 min before seeking help; document what you tried",
    ),
    dict(
        employee_name="Guna",
        goal_type="Attitude",
        status="Not Started",
        priority="Critical",
        title="Curious Learner",
        iceberg_level="Self-Image",
        current_rating=1.5,
        focus_area="Strengthen Urgently",
        daily_practice="Ask 'why does this number look like this?' for every dashboard anomaly; maintain a curiosity log",
    ),
    dict(
        employee_name="Guna",
        goal_type="Attitude",
        status="Not Started",
        priority="Critical",
        title="Technical Mastery",
        iceberg_level="Motive",
        current_rating=1.0,
        focus_area="Ignite",
        daily_practice="Set a 90-day technical goal: 'I will master Power BI DAX & Service.' Display this goal at your workstation",
    ),
    # ── Vetri ────────────────────────────────────────────────────────────────
    dict(
        employee_name="Vetri",
        goal_type="Result",
        status="Not Started",
        priority="Critical",
        title="Power BI Foundation Building",
        success_criteria="Complete Power BI Desktop basics and publish 1 working dashboard by end of 45 days",
        frequency="45 days",
        target="Reviewed by Manager Analyst",
        tracking_method="",
    ),
    dict(
        employee_name="Vetri",
        goal_type="Result",
        status="Not Started",
        priority="Critical",
        title="DAX Learning Progress",
        success_criteria="Write and explain 5 core DAX measures correctly (SUM, CALCULATE, FILTER, DIVIDE, IF)",
        frequency="45 days",
        target="Tested by manager",
        tracking_method="",
    ),
    dict(
        employee_name="Vetri",
        goal_type="Result",
        status="Not Started",
        priority="Critical",
        title="Dashboard Delivery",
        success_criteria="Deliver all assigned dashboard tasks on time with zero quality rework",
        frequency="Monthly",
        target="Track completion vs. deadline",
        tracking_method="",
    ),
    dict(
        employee_name="Vetri",
        goal_type="Result",
        status="Not Started",
        priority="Critical",
        title="Daily Learning Habit",
        success_criteria="Log 45 minutes of structured self-study daily; share weekly summary every Friday",
        frequency="Weekly",
        target="Learning log submitted to manager",
        tracking_method="",
    ),
    dict(
        employee_name="Vetri",
        goal_type="Result",
        status="Not Started",
        priority="Critical",
        title="Data Quality Awareness",
        success_criteria="Apply data validation checklist for every dataset before building dashboard visuals",
        frequency="Monthly",
        target="Checklist completion tracked",
        tracking_method="",
    ),
    dict(
        employee_name="Vetri",
        goal_type="Skill",
        status="Not Started",
        priority="Critical",
        title="Power BI Ecosystem (Service/RLS/Refresh)",
        current_rating=1.0,
        target_rating=2.0,
        learning_action="Complete Microsoft Learn: Power BI Service fundamentals; set up personal workspace with 1 published report",
        completion_by="45 Days",
    ),
    dict(
        employee_name="Vetri",
        goal_type="Skill",
        status="Not Started",
        priority="Critical",
        title="Statistics & Analytics Fundamentals",
        current_rating=1.0,
        target_rating=2.0,
        learning_action="Study averages, trend analysis, basic correlation; apply in next dashboard with commentary on insights",
        completion_by="45 Days",
    ),
    dict(
        employee_name="Vetri",
        goal_type="Skill",
        status="Not Started",
        priority="Critical",
        title="Data Governance & Quality",
        current_rating=1.0,
        target_rating=2.0,
        learning_action="Create a personal data validation checklist; apply to every dataset before building visuals",
        completion_by="45 Days",
    ),
    dict(
        employee_name="Vetri",
        goal_type="Skill",
        status="Not Started",
        priority="Critical",
        title="Visualization Best Practices",
        current_rating=1.0,
        target_rating=2.0,
        learning_action="Study when to use bar/line/donut charts; redesign 1 existing dashboard with correct visual choices",
        completion_by="45 Days",
    ),
    dict(
        employee_name="Vetri",
        goal_type="Skill",
        status="Not Started",
        priority="Critical",
        title="DAX (Data Analysis Expressions)",
        current_rating=2.0,
        target_rating=3.0,
        learning_action="Practice 10 core DAX patterns; write measures from scratch without copy-pasting; explain logic to manager",
        completion_by="45 Days",
    ),
    dict(
        employee_name="Vetri",
        goal_type="Skill",
        status="Not Started",
        priority="Critical",
        title="SQL Querying",
        current_rating=1.5,
        target_rating=2.0,
        learning_action="Complete SQL basics course (SELECT, WHERE, JOIN, GROUP BY); run 5 practice queries on client data",
        completion_by="45 Days",
    ),
    dict(
        employee_name="Vetri",
        goal_type="Attitude",
        status="Not Started",
        priority="Critical",
        title="Curious Learner",
        iceberg_level="Self-Image",
        current_rating=1.0,
        focus_area="Build Urgently",
        daily_practice="Every day: explore 1 new Power BI feature. Log it. Ask 'what else can this do?' Eliminate passive learning",
    ),
    dict(
        employee_name="Vetri",
        goal_type="Attitude",
        status="Not Started",
        priority="Critical",
        title="Reliable Analyst",
        iceberg_level="Self-Image",
        current_rating=1.0,
        focus_area="Build Urgently",
        daily_practice="Never submit work without self-testing. Affirm: 'My numbers can be trusted.' Take pride in accuracy from day 1",
    ),
    dict(
        employee_name="Vetri",
        goal_type="Attitude",
        status="Not Started",
        priority="Critical",
        title="Self-Driven Learning",
        iceberg_level="Trait",
        current_rating=2.0,
        focus_area="Build Consistently",
        daily_practice="Study 45 min daily without being asked. Post your weekly learning goal in the team group every Monday morning",
    ),
    dict(
        employee_name="Vetri",
        goal_type="Attitude",
        status="Not Started",
        priority="Critical",
        title="Technical Mastery",
        iceberg_level="Motive",
        current_rating=1.0,
        focus_area="Ignite Immediately",
        daily_practice="Write your 90-day goal: 'I will master Power BI basics by [date].' Display it at your workstation",
    ),
    dict(
        employee_name="Vetri",
        goal_type="Attitude",
        status="Not Started",
        priority="Critical",
        title="Patience with Data",
        iceberg_level="Trait",
        current_rating=1.0,
        focus_area="Build Urgently",
        daily_practice="Spend minimum 30 min trying to solve data issues independently before asking for help; document what you tried",
    ),
]


class Command(BaseCommand):
    help = "Seed all initial data for a fresh setup"

    def add_arguments(self, parser):
        parser.add_argument(
            "--force",
            action="store_true",
            help="Re-seed even if data already exists",
        )
        parser.add_argument(
            "--tasks",
            action="store_true",
            help="Also seed 20 sample tasks",
        )
        parser.add_argument(
            "--clear",
            action="store_true",
            help="Wipe all tasks before seeding (only relevant with --tasks)",
        )

    def handle(self, *args, **options):
        force = options["force"]
        org = self._ensure_org()
        self._seed_users(force, org)
        self._seed_masters(force, org)
        self._seed_lead_statuses(force, org)
        self._seed_app_settings(force, org)
        self._seed_pace_goals(force, org)
        if options["tasks"]:
            if options["clear"]:
                count, _ = Task.objects.all().delete()
                self.stdout.write(self.style.WARNING(f"  Cleared {count} existing tasks."))
            self._seed_tasks(org)
        self.stdout.write(self.style.SUCCESS("Done."))

    # ── Org ───────────────────────────────────────────────────────────────────

    def _ensure_org(self) -> Org:
        """Resolve which org the seeded data belongs to.

        Priority:
          1. ``SEED_ORG`` env var — match by name (case-insensitive).
          2. First existing Org in the DB.
          3. Create a new org called "Default".

        Every piece of seeded data (users, masters, tasks, PACE goals) is tagged
        with this org so the UI's org switcher sees it immediately.
        """
        import os

        name = os.environ.get("SEED_ORG")
        if name:
            org = Org.objects.filter(name__iexact=name).first()
            if not org:
                org = Org.objects.create(name=name)
                self.stdout.write(self.style.SUCCESS(f"  Org created: {org.name}"))
            else:
                self.stdout.write(f"  Org: using existing '{org.name}' (from SEED_ORG)")
            return org

        org = Org.objects.order_by("created_at").first()
        if org:
            self.stdout.write(f"  Org: using existing '{org.name}' (first in DB)")
            return org

        org = Org.objects.create(name="Default")
        self.stdout.write(self.style.SUCCESS(f"  Org created: {org.name}"))
        return org

    # ── Users ─────────────────────────────────────────────────────────────────

    def _seed_users(self, force: bool, org: Org) -> None:
        import os
        import secrets

        from users.models import ACCESS_FEATURES, OrgMembership

        # Admin membership lookup — "is there already someone who's admin
        # anywhere?" replaces the legacy User.role=="admin" single-org check.
        admin_membership = OrgMembership.objects.filter(role="admin").select_related("user").first()
        admin = admin_membership.user if admin_membership else None
        if not admin:
            admin_email = os.environ.get("SEED_ADMIN_EMAIL", "safy@example.com")
            admin_username = os.environ.get("SEED_ADMIN_USERNAME", "safy")
            admin_full_name = os.environ.get("SEED_ADMIN_FULL_NAME", "Safy")
            admin_password_env = os.environ.get("SEED_ADMIN_PASSWORD")
            admin_password = admin_password_env or secrets.token_urlsafe(16)
            admin = User.objects.create_user(
                email=admin_email,
                password=admin_password,
                username=admin_username,
                full_name=admin_full_name,
            )
            # Grant admin + every access flag in this org.
            OrgMembership.objects.create(
                user=admin,
                org=org,
                role="admin",
                is_default=True,
                **{feat: True for feat in ACCESS_FEATURES},
            )
            self.stdout.write(self.style.SUCCESS(f"  Admin user created (email: {admin.email})"))
            if admin_password_env:
                self.stdout.write("  Admin password: taken from SEED_ADMIN_PASSWORD env var.")
            else:
                self.stdout.write(
                    self.style.WARNING(
                        f"  Admin password (random): {admin_password}\n"
                        "  Set SEED_ADMIN_PASSWORD in your .env to use a known password on re-seed."
                    )
                )
        else:
            # Admin exists — make sure they're a member of the target org. If
            # they aren't yet, grant them an admin seat (idempotent).
            OrgMembership.objects.get_or_create(
                user=admin,
                org=org,
                defaults={
                    "role": "admin",
                    "is_default": not admin.memberships.exists(),
                    **{feat: True for feat in ACCESS_FEATURES},
                },
            )
            self.stdout.write(f"  Admin user already exists — ensured admin membership in '{org.name}'.")

        employee_password_env = os.environ.get("SEED_EMPLOYEE_PASSWORD")
        default_employee_password = employee_password_env or secrets.token_urlsafe(12)
        created = 0
        all_employees = [n for n in TEAM_MEMBERS + PACE_EMPLOYEES if n != "Safy"]
        for name in all_employees:
            username = name.lower()
            existing = User.objects.filter(username=username).first()
            if existing is None:
                user = User.objects.create_user(
                    username=username,
                    password=default_employee_password,
                    full_name=name,
                )
                OrgMembership.objects.create(user=user, org=org, role="employee", is_default=True)
                created += 1
            else:
                # Ensure the existing user has a membership in this org.
                OrgMembership.objects.get_or_create(
                    user=existing,
                    org=org,
                    defaults={
                        "role": "employee",
                        "is_default": not existing.memberships.exists(),
                    },
                )
        total = len(all_employees)
        self.stdout.write(
            self.style.SUCCESS(
                f"  Team member users: {created} created"
                + (f", {total - created} already existed." if created < total else ".")
            )
        )
        if created:
            if employee_password_env:
                self.stdout.write("  Team member password: taken from SEED_EMPLOYEE_PASSWORD env var.")
            else:
                self.stdout.write(
                    self.style.WARNING(
                        f"  Team member password (random, shared): {default_employee_password}\n"
                        "  Set SEED_EMPLOYEE_PASSWORD in your .env to use a known password on re-seed."
                    )
                )

    # ── Masters ───────────────────────────────────────────────────────────────

    def _seed_masters(self, force: bool, org: Org) -> None:
        # Back-fill org on any previously-seeded masters with org=None so
        # they become visible to admins scoped to this org.
        backfilled = Master.objects.filter(org__isnull=True).update(org=org)
        if backfilled:
            self.stdout.write(f"  Masters: back-filled org on {backfilled} existing rows")

        if not force and Master.objects.filter(org=org).exists():
            self.stdout.write("  Masters already exist for this org — skipping (use --force to re-seed)")
            return

        created = 0
        for i, name in enumerate(CLIENTS, start=1):
            _, was_created = Master.objects.get_or_create(
                name=name,
                type="client",
                org=org,
                defaults={"sort_order": i},
            )
            if was_created:
                created += 1

        for i, name in enumerate(CATEGORIES, start=1):
            _, was_created = Master.objects.get_or_create(
                name=name,
                type="category",
                org=org,
                defaults={"sort_order": i},
            )
            if was_created:
                created += 1

        for i, name in enumerate(TEAM_MEMBERS, start=1):
            _, was_created = Master.objects.get_or_create(
                name=name,
                type="team",
                org=org,
                defaults={
                    "sort_order": i,
                    "color": AVATAR_COLORS.get(name, ""),
                },
            )
            if was_created:
                created += 1

        self.stdout.write(f"  Masters: {created} created")

    # ── Lead statuses ─────────────────────────────────────────────────────────

    def _seed_lead_statuses(self, force: bool, org: Org) -> None:
        # Back-fill any previously-seeded statuses with org=None
        LeadStatus.objects.filter(org__isnull=True).update(org=org)

        if not force and LeadStatus.objects.filter(org=org).exists():
            self.stdout.write("  LeadStatuses already exist for this org — skipping")
            return

        created = 0
        for ls in LEAD_STATUSES:
            _, was_created = LeadStatus.objects.get_or_create(
                name=ls["name"],
                org=org,
                defaults={"color": ls["color"], "sort_order": ls["sort_order"]},
            )
            if was_created:
                created += 1

        self.stdout.write(f"  LeadStatuses: {created} created")

    # ── App settings ──────────────────────────────────────────────────────────

    def _seed_app_settings(self, force: bool, org: Org) -> None:
        # Back-fill org on any previously-seeded settings with org=None
        AppSetting.objects.filter(org__isnull=True).update(org=org)

        created = 0
        for setting in APP_SETTINGS:
            if force:
                AppSetting.objects.update_or_create(
                    key=setting["key"],
                    org=org,
                    defaults={"value": setting["value"]},
                )
                created += 1
            else:
                _, was_created = AppSetting.objects.get_or_create(
                    key=setting["key"],
                    org=org,
                    defaults={"value": setting["value"]},
                )
                if was_created:
                    created += 1

        self.stdout.write(f"  AppSettings: {created} created/updated")

    # ── PACE goals ────────────────────────────────────────────────────────────

    @staticmethod
    def _parse_completion_by(value: str | None) -> date | None:
        """Convert a duration string like '45 Days' to today + N days."""
        if not value:
            return None
        match = re.match(r"(\d+)\s*[Dd]ays?", value)
        if match:
            return date.today() + timedelta(days=int(match.group(1)))
        return None

    def _seed_pace_goals(self, force: bool, org: Org) -> None:
        PaceGoal.objects.filter(org__isnull=True).update(org=org)

        if not force and PaceGoal.objects.filter(org=org).exists():
            self.stdout.write("  PaceGoals already exist for this org — skipping (use --force to re-seed)")
            return

        created = skipped = 0
        for g in SEED_GOALS:
            profile = User.objects.filter(username=g["employee_name"].lower()).first()
            defaults: dict = {
                "org": org,
                "goal_type": g["goal_type"],
                "status": g["status"],
                "priority": g["priority"],
                "current_rating": g.get("current_rating", 0),
                "target_rating": g.get("target_rating", 0),
                "success_criteria": g.get("success_criteria", ""),
                "frequency": g.get("frequency", ""),
                "target": g.get("target", ""),
                "tracking_method": g.get("tracking_method", ""),
                "learning_action": g.get("learning_action", ""),
                "completion_by": self._parse_completion_by(g.get("completion_by")),
                "iceberg_level": g.get("iceberg_level", ""),
                "focus_area": g.get("focus_area", ""),
                "daily_practice": g.get("daily_practice", ""),
                "profile": profile,
            }
            _, was_created = PaceGoal.objects.get_or_create(
                title=g["title"],
                goal_type=g["goal_type"],
                profile=profile,
                org=org,
                defaults=defaults,
            )
            if was_created:
                created += 1
            else:
                skipped += 1

        self.stdout.write(
            self.style.SUCCESS(f"  PaceGoals: {created} created")
            + (f", {skipped} already existed." if skipped else ".")
        )

    # ── Sample tasks ──────────────────────────────────────────────────────────

    def _seed_tasks(self, org: Org) -> None:
        # Back-fill org on any previously-seeded tasks with org=None
        Task.objects.filter(org__isnull=True).update(org=org)

        admin_user = User.objects.filter(memberships__role="admin").distinct().first()
        created = skipped = 0

        for t in INITIAL_TASKS:
            client_obj = Master.objects.filter(type="client", name=t["client"], org=org).first()
            category_obj = Master.objects.filter(type="category", name=t["category"], org=org).first()
            # Case-insensitive — seeded admin may be "Safy" while employees are lowercase.
            responsible_obj = User.objects.filter(username__iexact=t["responsible"]).first()

            # use description as a stable dedup key
            _, was_created = Task.objects.get_or_create(
                description=t["description"],
                client=client_obj,
                org=org,
                defaults={
                    "category": category_obj,
                    "status": t["status"],
                    "target_date": t["target_date"] or None,
                    "expected_date": t["expected_date"] or None,
                    "completed_date": t["comp_date"] or None,
                    "responsible": responsible_obj,
                    "remarks": t["remarks"],
                    "recurrence": t["recurrence"],
                    "created_by": admin_user,
                },
            )
            if was_created:
                created += 1
            else:
                skipped += 1

        self.stdout.write(
            self.style.SUCCESS(f"  Tasks: {created} created") + (f", {skipped} already existed." if skipped else ".")
        )
