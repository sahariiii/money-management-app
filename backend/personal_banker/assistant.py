"""The app's assistant: Claude answering questions about the user's spending with tools over the ledger.

Each question runs one tool-runner loop: Claude looks up what it needs (totals for
a period, a card's spending, the transactions behind a number) and answers in
plain text for a phone chat bubble, optionally with one headline number
(show_headline) that the app shows as a small card under the answer.

Conversations are kept one per file in library/chats/ as the app shows them, each
with a title that Claude gives it on the first question (name_conversation), like
the chat history in Claude or ChatGPT. Earlier turns of the same conversation go back
to Claude as plain text, without the tool calls behind them, so a long history stays
small and each answer works from fresh numbers.
"""

import json
import re
import secrets
import threading
from collections import defaultdict
from datetime import date, datetime, timezone
from typing import Literal

import anthropic
from anthropic import beta_tool
from anthropic.lib.tools import ToolError

from . import ledger, planning, rewards
from .ledger import APP_CATEGORIES, CASH_CARD_ID, DUMMY_CARD, INCOME_CATEGORIES, AppModel, Transaction
from .llm import FALLBACK_BETA, MODEL
from .store import Library

# Someone is waiting on the reply: medium is quick enough and handles a few rounds of lookups well.
EFFORT = "medium"
MAX_TOKENS = 16000
# Tool rounds per question; a monthly comparison across cards takes a handful.
MAX_ITERATIONS = 12
# Earlier messages sent back with a new question.
HISTORY_MESSAGES = 30
MAX_TRANSACTIONS = 200

Tone = Literal["primary", "income", "expense", "warning"]

SYSTEM_PROMPT = f"""\
You are the money assistant in Personal Banker, a budgeting app for one person in \
Canada. They upload bank and credit-card statements and scan receipts; the app turns \
them into one ledger. Answer their questions about their spending and help them \
understand it: per month, per card, per category or per merchant.

Look numbers up with the tools every time; never estimate or reuse a figure from \
earlier in the conversation, since statements may have been added since. The ledger \
only covers the statements uploaded so far: if a period has no transactions, say \
the records don't reach that far rather than reporting zero spending.

How the data works:
- Amounts are CAD and always positive; is_income gives the direction. Money in has \
an income category ({", ".join(INCOME_CATEGORIES)}), except refunds: money back for a \
purchase (a store return, a cancelled order, a fee rebate, a reversed charge), under \
the spending category it came back to. Refunds aren't income. The ledger links each \
refund to the purchase it returns, and spending counts only what the user kept: a \
returned purchase adds nothing and a partly returned one adds what wasn't refunded; a \
refund with no purchase found comes off spending on its own date. The tools' totals \
already work this way, so never add refunds to income; mention a return when it \
explains a total.
- Spending categories: {", ".join(c for c in APP_CATEGORIES if c not in INCOME_CATEGORIES)}. \
Food is restaurants, cafés, takeout and delivery; Groceries is separate. Gas & EV \
charging is fuel and charging stations; Transport is transit, taxis and rideshare; Car \
is the user's car: insurance, financing or lease payments, maintenance, parking and tolls. \
Fees & interest is bank and card fees and interest charged, which earn no cashback.
- Card "{CASH_CARD_ID}" is cash (receipts not paid by card). Card "{DUMMY_CARD.id}" \
("{DUMMY_CARD.nickname}") holds statements whose account number matches none of the \
user's cards; if it carries spending that matters to the answer, suggest adding the \
card's account number in the Cards tab.
- budgets_and_goal has their monthly budget per category and their savings goal (they \
have at most one). Progress toward the goal is money in minus money out since the day \
they set it, counted up to the latest transaction in the ledger, since statements \
arrive after the fact; compare it with what a steady pace would have saved by then. \
They set the goal and budgets under More, Savings goal. Bill reminders aren't \
available to you yet.

Cashback: always get it from the cashback tool, never work it out from spending and \
reward rules yourself.
- What a statement prints (from_statements) is what the bank actually paid: it is the \
answer. Give it per statement with its period (e.g. "your Oct2026 statement, Sep 14 to \
Oct 13: $45.65"), since statements follow the card's billing cycle, not calendar months. \
Never prorate, split or recalculate a printed amount, and don't offer your own figure \
next to it.
- Only for spending no statement reports yet (estimate_for_spending_not_on_a_statement) \
give the tool's estimate, clearly called an estimate, with a short warning: it comes \
from the app's categories and the reward rules entered for the card, while the bank \
rates each purchase by the type of store, pays only the base rate on foreign-currency \
purchases and may apply limits, so the statement can come out different. When an \
answer has both, give the printed amount and the estimate separately, never as one total.

Good insights are specific: name the categories, merchants and cards behind a change, \
compare like with like (a month in progress against the same days of the month \
before), and point out what stands out, such as a jump in a category, a recurring \
charge that went up, an unusually large purchase, or spending on a card that earns \
less than another would (each card's reward rules are in list_cards). Offer one or \
two concrete suggestions when they would help; don't lecture.

Your reply appears as plain text in a chat bubble on a phone. Don't use Markdown: \
no headings, bold, tables or code. Write short paragraphs; for a list, start each \
line with "• ". Keep it under about 120 words unless they ask for detail. Write \
money like $1,234.56 and months by name. When the answer comes down to one number, \
call show_headline with it once, just before you answer. Never write more than the \
last 4 digits of a card or account number.

When the context says the conversation is new, also call name_conversation once, \
alongside your first lookup, with a short title for the user's chat history."""


class ChatSummary(AppModel):
    value: str
    label: str
    tone: Tone | None = None


class ChatMessage(AppModel):
    """ChatMessage in src/types.ts."""

    id: str
    role: Literal["user", "assistant"]
    text: str
    created_at: str
    summary: ChatSummary | None = None


class ChatThread(AppModel):
    """ChatThread in src/types.ts: a conversation as the chat history lists it."""

    id: str
    title: str
    created_at: str
    updated_at: str  # when its latest message was added
    message_count: int
    preview: str  # the start of its latest answer


class ChatThreadDetail(ChatThread):
    messages: list[ChatMessage]


class ChatReply(AppModel):
    """What asking returns: the answer, and its conversation as the history now lists it."""

    thread: ChatThread
    message: ChatMessage


class AssistantError(RuntimeError):
    """Claude couldn't answer (a refusal or a cut-off reply)."""


class UnknownChat(LookupError):
    """No conversation with that id."""


_chat_lock = threading.Lock()
_CHAT_ID = re.compile(r"chat_[0-9a-f]{12}")
TITLE_LENGTH = 60
PREVIEW_LENGTH = 120


def is_chat_id(chat_id: str) -> bool:
    return bool(_CHAT_ID.fullmatch(chat_id))


def _shorten(text: str, limit: int) -> str:
    """The text on one line, cut at a word boundary with "…" when longer than `limit`."""
    text = " ".join(text.split())
    if len(text) <= limit:
        return text
    cut = text[: limit - 1].rsplit(" ", 1)[0] or text[: limit - 1]
    return f"{cut.rstrip(' ,.;:')}…"


def _new_chat(title: str) -> dict:
    return {"id": f"chat_{secrets.token_hex(6)}", "title": title, "messages": []}


def _move_legacy_chat(library: Library) -> None:
    """chat.json held the one conversation before there were several; it becomes the first of them."""
    if (messages := library.legacy_chat()) is None:
        return
    if messages:
        first = next((m["text"] for m in messages if m["role"] == "user"), "Earlier conversation")
        library.save_chat({**_new_chat(_shorten(first, TITLE_LENGTH)), "messages": messages})
    library.remove_legacy_chat()


def _thread(chat: dict) -> ChatThread:
    messages = chat["messages"]
    latest = next((m for m in reversed(messages) if m["role"] == "assistant"), messages[-1] if messages else None)
    return ChatThread(
        id=chat["id"],
        title=chat["title"],
        created_at=messages[0]["created_at"] if messages else "",
        updated_at=messages[-1]["created_at"] if messages else "",
        message_count=len(messages),
        preview=_shorten(latest["text"], PREVIEW_LENGTH) if latest else "",
    )


def threads(library: Library) -> list[ChatThread]:
    """Every conversation, the latest active first."""
    with _chat_lock:
        _move_legacy_chat(library)
        chats = library.chats()
    return sorted((_thread(c) for c in chats if c["messages"]), key=lambda t: t.updated_at, reverse=True)


def thread(library: Library, chat_id: str) -> ChatThreadDetail | None:
    if not is_chat_id(chat_id) or (chat := library.chat(chat_id)) is None:
        return None
    return ChatThreadDetail(**_thread(chat).model_dump(), messages=[ChatMessage.model_validate(m) for m in chat["messages"]])


def rename(library: Library, chat_id: str, title: str) -> ChatThread | None:
    with _chat_lock:
        if not is_chat_id(chat_id) or (chat := library.chat(chat_id)) is None:
            return None
        chat["title"] = _shorten(title, TITLE_LENGTH)
        library.save_chat(chat)
    return _thread(chat)


def delete(library: Library, chat_id: str) -> bool:
    with _chat_lock:
        if not is_chat_id(chat_id) or library.chat(chat_id) is None:
            return False
        library.delete_chat(chat_id)
    return True


def _message(role: Literal["user", "assistant"], text: str, summary: ChatSummary | None = None) -> ChatMessage:
    return ChatMessage(
        id=f"msg_{secrets.token_hex(6)}",
        role=role,
        text=text,
        created_at=datetime.now(timezone.utc).isoformat(timespec="seconds"),
        summary=summary,
    )


# ---------------------------------------------------------------------------
# Tools


def _day(value: str, name: str) -> str:
    try:
        return date.fromisoformat(value).isoformat()
    except ValueError:
        raise ToolError(f"{name} must be a date as YYYY-MM-DD, got {value!r}.") from None


def _money(amount: float) -> float:
    return round(amount, 2)


def _make_tools(library: Library, shown: list[ChatSummary], named: list[str]) -> list:
    """The tools for one question. The ledger is read once: it doesn't change while Claude answers.

    The tool list is the same for every question, new conversation or not, so it stays in the cache.
    """
    txs: list[Transaction] = ledger.transactions(library)
    cards = ledger.cards(library)
    names = {c.id: f"{c.nickname} (•••• {c.last4})" for c in cards if not c.is_placeholder}
    names[DUMMY_CARD.id] = DUMMY_CARD.nickname
    names[CASH_CARD_ID] = "Cash"

    def check_card(card_id: str | None) -> None:
        if card_id is not None and card_id not in names:
            raise ToolError(f"Unknown card_id {card_id!r}. Call list_cards for the ids.")

    def check_category(category: str | None) -> None:
        if category is not None and category not in APP_CATEGORIES:
            raise ToolError(f"Unknown category {category!r}. Use one of: {', '.join(APP_CATEGORIES)}.")

    def select(start_date: str, end_date: str, card_id: str | None, category: str | None) -> list[Transaction]:
        start, end = _day(start_date, "start_date"), _day(end_date, "end_date")
        check_card(card_id)
        check_category(category)
        return [
            t
            for t in txs
            if start <= t.date <= end and (card_id is None or t.card_id == card_id) and (category is None or t.category == category)
        ]

    @beta_tool
    def list_cards() -> str:
        """The user's cards and the cashback rates entered for each per category, plus the date range the ledger covers.

        Use the card ids with the other tools' card_id. A rule with category "*" applies to every
        category without its own rule; cap is the monthly spend that earns that rate (null: no cap).
        For cashback actually earned, use the cashback tool.
        """
        rules = ledger.reward_rules(library)
        dates = sorted(t.date for t in txs)
        return json.dumps(
            {
                "cards": [
                    {
                        "card_id": c.id,
                        "name": names.get(c.id, c.nickname),
                        "institution": c.institution,
                        "type": c.type,
                        "annual_fee": c.annual_fee,
                        "interest_rate_percent": c.interest_rate,
                        "statement_closes_on_day": c.cycle_day,
                        "reward_rules": [
                            {"category": r.category, "rate_percent": r.rate_percent, "monthly_cap": r.cap}
                            for r in rules
                            if r.card_id == c.id
                        ],
                    }
                    for c in cards
                ]
                + [{"card_id": CASH_CARD_ID, "name": "Cash"}],
                "ledger_first_date": dates[0] if dates else None,
                "ledger_last_date": dates[-1] if dates else None,
                "transaction_count": len(txs),
            },
            ensure_ascii=False,
        )

    @beta_tool
    def spending_summary(start_date: str, end_date: str, card_id: str | None = None, category: str | None = None) -> str:
        """Totals for a period: spending (net of returns) and income, by category, card and month, and the top merchants.

        Call it once per period to compare periods (e.g. one call per month). Refunds aren't
        income: they come off the spending they returned (see returns).

        Args:
            start_date: First day of the period, YYYY-MM-DD (included).
            end_date: Last day of the period, YYYY-MM-DD (included).
            card_id: Only this card's transactions (ids from list_cards).
            category: Only this category.
        """
        rows = select(start_date, end_date, card_id, category)
        spending = [(t, amount) for t in rows if (amount := ledger.net_spending(t))]
        income = [(t, t.amount) for t in rows if t.is_income and not ledger.is_refund(t)]
        refunds = [t for t in rows if ledger.is_refund(t)]

        def grouped(items: list[tuple[Transaction, float]], key, total: float, top: int | None = None) -> list[dict]:
            groups: dict[str, list[float]] = defaultdict(list)
            for t, amount in items:
                groups[key(t)].append(amount)
            result = sorted(
                (
                    {
                        "name": name,
                        "amount": _money(sum(amounts)),
                        "count": len(amounts),
                        "share_percent": round(100 * sum(amounts) / total) if total else 0,
                    }
                    for name, amounts in groups.items()
                ),
                key=lambda g: -g["amount"],
            )
            return result[:top] if top else result

        total_spent = sum(amount for _, amount in spending)
        total_income = sum(amount for _, amount in income)
        months: dict[str, dict] = {}
        for t in sorted(rows, key=lambda t: t.date):
            months.setdefault(t.date[:7], {"month": t.date[:7], "spent": 0.0, "income": 0.0})
        for key, items in (("spent", spending), ("income", income)):
            for t, amount in items:
                months[t.date[:7]][key] += amount
        return json.dumps(
            {
                "period": {"start_date": start_date, "end_date": end_date},
                "total_spent": _money(total_spent),
                "total_income": _money(total_income),
                "net": _money(total_income - total_spent),
                "returns": {
                    "count": len(refunds),
                    "amount": _money(sum(t.amount for t in refunds)),
                    "linked_to_their_purchase": sum(1 for t in refunds if t.refund_of),
                },
                "transaction_count": len(rows),
                "spending_by_category": grouped(spending, lambda t: t.category, total_spent),
                "spending_by_card": grouped(spending, lambda t: names.get(t.card_id, t.card_id), total_spent),
                "spending_by_month": [{**m, "spent": _money(m["spent"]), "income": _money(m["income"])} for m in months.values()],
                "income_by_category": grouped(income, lambda t: t.category, total_income),
                "top_merchants": grouped(spending, lambda t: t.merchant, total_spent, top=10),
            },
            ensure_ascii=False,
        )

    @beta_tool
    def find_transactions(
        start_date: str,
        end_date: str,
        card_id: str | None = None,
        category: str | None = None,
        search: str | None = None,
        kind: Literal["expense", "income"] | None = None,
        sort: Literal["newest", "largest"] = "newest",
        limit: int = 50,
    ) -> str:
        """Individual transactions in a period, to see what is behind a total or find specific purchases.

        Args:
            start_date: First day, YYYY-MM-DD (included).
            end_date: Last day, YYYY-MM-DD (included).
            card_id: Only this card's transactions (ids from list_cards).
            category: Only this category.
            search: Text to find in the merchant or the statement description, case-insensitive.
            kind: Only money out (expense) or money in (income).
            sort: newest first, or largest amount first.
            limit: At most this many transactions (up to 200).
        """
        needle = (search or "").strip().casefold()
        rows = [
            t
            for t in select(start_date, end_date, card_id, category)
            if (kind is None or t.is_income == (kind == "income"))
            and (not needle or needle in f"{t.merchant} {t.raw_description}".casefold())
        ]
        rows.sort(key=(lambda t: -t.amount) if sort == "largest" else (lambda t: t.date), reverse=sort == "newest")
        shown_rows = rows[: max(1, min(limit, MAX_TRANSACTIONS))]
        by_id = {t.id: t for t in txs}

        def returns(t: Transaction) -> dict:
            """How a refund or a returned purchase is linked to the other side."""
            if ledger.is_refund(t):
                purchase = by_id.get(t.refund_of or "")
                return {"is_refund": True, "returns_purchase_on": purchase.date if purchase else None}
            if t.refund_ids:
                return {"returned_amount": t.refunded_amount, "returned_on": [by_id[r].date for r in t.refund_ids if r in by_id]}
            return {}

        return json.dumps(
            {
                "matching": len(rows),
                "shown": len(shown_rows),
                "total_amount_of_matching_expenses": _money(sum(t.amount for t in rows if not t.is_income)),
                "transactions": [
                    {
                        "date": t.date,
                        "merchant": t.merchant,
                        "amount": t.amount,
                        "is_income": t.is_income,
                        "category": t.category,
                        "card": names.get(t.card_id, t.card_id),
                        "description": t.raw_description,
                        **returns(t),
                    }
                    for t in shown_rows
                ],
            },
            ensure_ascii=False,
        )

    @beta_tool
    def cashback(start_date: str, end_date: str, card_id: str | None = None) -> str:
        """Cashback the user's cards earned: the amounts printed on their statements, plus an estimate
        for card spending in the period that no statement reports yet.

        Statements follow each card's billing cycle (e.g. Sep 14 - Oct 13), not calendar months:
        every statement whose period overlaps the dates is listed whole, with its period. The
        estimate only covers transactions in the dates that aren't on a statement with a printed
        rewards summary, so the two never count the same purchase.

        Args:
            start_date: First day, YYYY-MM-DD (included).
            end_date: Last day, YYYY-MM-DD (included).
            card_id: Only this card (ids from list_cards).
        """
        start, end = _day(start_date, "start_date"), _day(end_date, "end_date")
        check_card(card_id)
        rules = ledger.reward_rules(library)
        statements = rewards.statement_rewards(library)
        reported = {s.statement_id for s in statements if s.reported}

        def period(s: rewards.StatementRewards) -> tuple[str | None, str | None]:
            """The printed period, else the dates of its transactions."""
            dates = sorted(t.date for t in txs if t.statement_id == s.statement_id)
            return s.period_start or (dates[0] if dates else None), s.period_end or (dates[-1] if dates else None)

        result = []
        for c in cards:
            if c.is_placeholder or (card_id is not None and c.id != card_id):
                continue
            printed = [
                (s, p)
                for s in statements
                if s.card_id == c.id and s.reported and (p := period(s))[0] and p[0] <= end and (p[1] or p[0]) >= start
            ]
            if not printed and not any(r.card_id == c.id for r in rules):
                continue  # no rewards on this card
            unreported = [t for t in txs if t.card_id == c.id and start <= t.date <= end and t.statement_id not in reported]
            est = rewards.estimate(unreported, rules, c.id)
            result.append(
                {
                    "card_id": c.id,
                    "card": names[c.id],
                    "from_statements": [
                        {
                            "statement": s.name,
                            "period_start": p[0],
                            "period_end": p[1],
                            "cashback": s.reported.earned,
                            "unit": s.reported.unit,
                            "program": s.reported.program,
                            "lines": [{"label": line.label, "amount": line.amount} for line in s.reported.lines],
                        }
                        for s, p in sorted(printed, key=lambda sp: sp[1][0])
                    ],
                    "estimate_for_spending_not_on_a_statement": est.as_dict() if est.first_date else None,
                }
            )
        return json.dumps({"period": {"start_date": start, "end_date": end}, "cards": result}, ensure_ascii=False)

    @beta_tool
    def budgets_and_goal(month: str) -> str:
        """The user's monthly budgets with what they spent against each in a month, and their savings goal's progress.

        A budget's spent is purchases less what was returned, as the app's Budgets list counts it.
        savings_goal is null when they haven't set one.

        Args:
            month: The month to check the budgets for, YYYY-MM.
        """
        first = _day(f"{month}-01", "month")[:7]
        spent: dict[str, float] = defaultdict(float)
        for t in txs:
            if t.date.startswith(first):
                spent[t.category] += ledger.net_spending(t)
        saved_goal = planning.goal(library)
        return json.dumps(
            {
                "month": first,
                "budgets": [
                    {
                        "category": b.category,
                        "monthly_limit": b.monthly_limit,
                        "spent": _money(spent[b.category]),
                        "left": _money(b.monthly_limit - spent[b.category]),
                        "percent_used": round(100 * spent[b.category] / b.monthly_limit),
                    }
                    for b in planning.budgets(library)
                ],
                "savings_goal": planning.goal_progress(saved_goal, txs, date.today()) if saved_goal else None,
            },
            ensure_ascii=False,
        )

    @beta_tool
    def show_headline(value: str, label: str, tone: Tone = "primary") -> str:
        """Shows one key number as a small card under your answer. Use it at most once per answer.

        Args:
            value: The number as it should appear, e.g. "$1,234.56" or "85%".
            label: A few words saying what it is, e.g. "Spent in September".
            tone: expense for money out or overspending, income for money in or savings, warning for something to watch, primary otherwise.
        """
        shown[:] = [ChatSummary(value=value[:24], label=label[:60], tone=tone)]
        return "Shown."

    @beta_tool
    def name_conversation(title: str) -> str:
        """Names this conversation in the user's chat history. Call it once, only in a new conversation.

        Args:
            title: 2 to 6 words saying what the conversation is about, in sentence case, without quotes or a final period, e.g. "October spending vs September" or "Best card for groceries".
        """
        if clean := title.strip().strip("\"'").rstrip("."):
            named[:] = [clean]
        return "Named."

    return [list_cards, spending_summary, find_transactions, cashback, budgets_and_goal, show_headline, name_conversation]


# ---------------------------------------------------------------------------
# Asking


def _context(today: date, new: bool) -> str:
    context = f"Today is {today.strftime('%A')} {today.isoformat()}."
    return f"{context} This is a new conversation: name it with name_conversation." if new else context


def _past_turns(messages: list[ChatMessage]) -> list[dict]:
    """The latest messages as alternating plain-text turns, starting with the user."""
    recent = messages[-HISTORY_MESSAGES:]
    while recent and recent[0].role != "user":
        recent = recent[1:]
    turns: list[dict] = []
    for m in recent:
        if turns and turns[-1]["role"] == m.role:  # e.g. a question whose answer failed
            turns[-1]["content"] += f"\n\n{m.text}"
        else:
            turns.append({"role": m.role, "content": m.text})
    return turns


def ask(client: anthropic.Anthropic, library: Library, question: str, chat_id: str | None = None) -> ChatReply:
    """Answers the question in conversation `chat_id`, or in a new one when it is None, and saves
    the question and the answer to it. A new conversation is named by Claude (name_conversation),
    else after the question.

    Raises UnknownChat for an unknown chat_id, AssistantError when Claude can't answer, and
    anthropic.APIError when the call fails; none of them saves anything (a new conversation isn't
    created), so the question can be asked again.
    """
    if chat_id is None:
        chat = _new_chat(_shorten(question, TITLE_LENGTH))
    elif not is_chat_id(chat_id) or (chat := library.chat(chat_id)) is None:
        raise UnknownChat(chat_id)
    past = [ChatMessage.model_validate(m) for m in chat["messages"]]

    shown: list[ChatSummary] = []
    named: list[str] = []
    messages = [*_past_turns(past), {"role": "user", "content": question}]
    runner = client.beta.messages.tool_runner(
        model=MODEL,
        max_tokens=MAX_TOKENS,
        max_iterations=MAX_ITERATIONS,
        betas=[FALLBACK_BETA],
        fallbacks="default",
        output_config={"effort": EFFORT},
        # The cached prefix covers the tools, the instructions and the conversation so far.
        cache_control={"type": "ephemeral"},
        system=[{"type": "text", "text": SYSTEM_PROMPT}, {"type": "text", "text": _context(date.today(), new=not past)}],
        tools=_make_tools(library, shown, named),
        messages=messages,
    )
    final = runner.until_done()

    if final.stop_reason == "refusal":
        raise AssistantError("I can't help with that question.")
    text = "\n\n".join(b.text.strip() for b in final.content if b.type == "text" and b.text.strip())
    if not text:
        if final.stop_reason == "tool_use":
            raise AssistantError("That question took too many steps. Try asking about a shorter period or one card.")
        raise AssistantError(f"I couldn't put an answer together (stop reason: {final.stop_reason}). Try again.")

    reply = _message("assistant", text, shown[0] if shown else None)
    added = [_message("user", question).model_dump(), reply.model_dump()]
    with _chat_lock:
        # Re-read: the conversation may have been renamed while Claude answered.
        saved = library.chat(chat["id"]) if past else None
        current = saved or chat
        if not past and named:
            current["title"] = _shorten(named[0], TITLE_LENGTH)
        current["messages"] = [*current["messages"], *added]
        library.save_chat(current)
    return ChatReply(thread=_thread(current), message=reply)
