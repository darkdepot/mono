# Orchestrator Compaction Instructions

Append the following sections to the ordinary compaction summary for the Mono Agent Workflow orchestrator session.

## НЕМЕДЛЕННОЕ СЛЕДУЮЩЕЕ ДЕЙСТВИЕ

State one concrete imperative with the exact paths and IDs needed to continue.

## ЖИВЫЕ ВОРКЕРЫ

For every live worker, record the Issue key, stage, thread ID, PID, and log path. Record also its продуктовое имя — the product-language name used for it in owner-facing statuses — so the resumed orchestrator keeps speaking product language instead of falling back to keys. Reconcile this list with the orchestrator root's `workers.json`; do not trust session memory alone.

## РЕШЕНИЯ ВЛАДЕЛЬЦА

Preserve owner decisions verbatim, including what was approved and **что НЕ одобрено**.

## РЕШИЛ САМ

Record each technical decision made autonomously during the current wave in one line with its reason.

## ТУПИКИ

Record attempted approaches that were rejected and why, so the next context does not repeat them.

## ПРОТОКОЛЬНЫЕ ГОТЧИ

Record active operational traps and exact recovery constraints that a resumed orchestrator must preserve.

## ОЧЕРЕДЬ ЗАДАЧ

List the next tasks in dependency order, including blocked and immediately runnable work.

## ПРЕДПОЧТЕНИЯ ВЛАДЕЛЬЦА

Preserve owner communication and workflow preferences that affect future decisions.

Do not include rereadable content such as full Project, PRD, Tech Spec, or Issue bodies, tool output, closed-wave detail, ledger entries, the worker registry, reports, or memory bodies. Use path pointers instead of content: point to `ledger.md`, `workers.json`, `reports/`, `discovery/`, and the configured memory index under the orchestrator root or product memory directory.
