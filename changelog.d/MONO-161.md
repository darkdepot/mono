# MONO-161

- Unblock mixed confirmation queues: reuse verified same-attempt confirmations without applying their writes again, and collect after all new connector writes have present observations in the active report session.
- Reject collection identifier reuse for another report at publication and mailbox acceptance; keep lost-response retries idempotent.
- Return one `accept report` response object and identify the violated observation-time boundary.
