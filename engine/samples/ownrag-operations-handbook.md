# OwnRAG operations handbook

## Retention

Raw uploads are kept for 90 days. Parsed chunks and their vectors are kept for the life of the
knowledge base, because deleting a chunk invalidates its citation in every stored conversation.
The audit log is shipped to cold storage after 180 days.

## Rate limits

The retrieval endpoint accepts 40 requests per second per workspace. Exceeding that returns HTTP
429 with a Retry-After header measured in milliseconds. Ingestion is throttled separately at 8
documents per minute to protect the parse queue.

## Escalation

A failed parse is retried twice with exponential backoff, then parked in the FAILED queue. An
operator must re-upload the document to move it out of that state.

## نظام إجازة الموظف

يستحق الموظف إجازة سنوية مدتها واحد وعشرون يوما مدفوعة الأجر. تزداد الإجازة إلى ثلاثين يوما
إذا أمضى الموظف خمس سنوات متصلة في الخدمة. يحدد صاحب العمل موعد الإجازة بعد إشعار الموظف
بمدة لا تقل عن ثلاثين يوما.
