# Проба: исполнитель Codex пишет в Linear через MCP

Итог: **прошла**.

Песочница исполнителя `codex-cli` пишет в Linear через MCP и читает записанное обратно. Но с флагами, которые исполнитель получает сегодня, запись отклоняется. Нужны ещё два переопределения при запуске, они описаны ниже.

Запуск 20.11.2026, Codex CLI 0.159.2. Задача MONO-449 в рабочем пространстве Linear (тестовое через этот вход недоступно, решение оркестратора в комментарии задачи). Проба писала только в MONO-449: один комментарий и статус In Progress.

## Флаги запуска

Обе попытки собраны как `invocation()` в `scripts/transports/codex-cli.mjs`: `codex exec --json --cd <worktree> --add-dir <reports>`, модель и усилие через `-c`, `sandbox_mode="workspace-write"`, `sandbox_workspace_write.writable_roots=[<worktree>, <reports>]`, `sandbox_workspace_write.network_access=true` (так ставит `launch.mjs`), stdin закрыт. `--ignore-user-config` нет: сервер `linear` (`https://mcp.linear.app/mcp`, вход OAuth) и `approval_policy = "never"` приходят из пользовательского `~/.codex/config.toml`. Точный argv с текстом задания лежит в `attempt-N/invocation.json`.

| Попытка | Отличие | Ответ |
| --- | --- | --- |
| `attempt-1` | ровно флаги исполнителя | `save_comment`: `MCP tool call requires approval, but approval policy is never`; в Linear ничего не попало (проверено хостом до второй попытки) |
| `attempt-2` | плюс `-c mcp_servers.linear.tools.save_comment.approval_mode="approve"` и то же для `save_issue` | комментарий создан, статус In Progress, обратное чтение совпало |

Мешает не песочница и не сеть: MCP-вызовы идут из процесса Codex, а не из песочного шелла. Отказ дают пишущие инструменты Linear: по умолчанию они требуют подтверждения, а `approval_policy = "never"` запрещает его спрашивать. Отметка `approve` заранее одобряет только названные инструменты, остальная конфигурация пользователя не меняется.

## Что нужно исполнителю для записи

- Пользовательская конфигурация Codex загружена (без `--ignore-user-config`), в ней сервер `linear` с уже выполненным входом OAuth. Новых ключей и входов проба не добавляла.
- При запуске нужен `-c mcp_servers.linear.tools.<tool>.approval_mode="approve"` для каждого пишущего инструмента, которым исполнитель должен пользоваться (в пробе `save_comment` и `save_issue`). Без этого запись отклоняется сразу и без вопросов.
- Встроенные приложения ChatGPT выключены флагом `--disable apps` (добавлен после пробы, MONO-460). Иначе модель может взять коннектор Linear из `codex_apps`, а отметки `approve` касаются только сервера `linear`, и запись отклоняется.
- В обеих попытках `network_access` был `true`, как у исполнителя. Работает ли запись с `false`, не проверялось.

## Файлы

| Файл | Что это |
| --- | --- |
| `attempt-1/session.jsonl` | журнал `--json` первой попытки: отказ `save_comment` |
| `attempt-2/session.jsonl` | журнал второй: ответы `save_comment`, `save_issue`, `get_issue` (поля `status`, `statusType`), `list_comments` |
| `attempt-N/invocation.json` | точный argv |
| `host-reread/list_comments-before-attempt-2.json` | чтение хоста между попытками: комментария пробы нет |
| `host-reread/list_comments.json`, `host-reread/get_issue-status.json` | независимое чтение оркестратором через его Linear MCP после попытки 2 |

Тело комментария, отправленное исполнителем, ответ записи и чтение хоста совпадают байт в байт (sha256 в `provenance.json`, `commentByteCompare`). Хост видит статус In Progress (`started`).

## Вычищено

Таблица замен из `provenance.json` (`redaction`) применена ко всем файлам: пути домашней папки, рабочей копии и временной папки, имя и id пользователя Linear, имя пространства в ссылках Linear, префикс ветки, имя и id проекта, id команды. В ответе `save_issue` строка описания задачи (ссылки пространства и проекта) заменена заглушкой с длиной и sha256 исходника; в журнале исполнителя заменено и её эхо. `sourceSha256` хранит отпечаток исходного журнала, восстановить его из вычищенных байтов нельзя. Stderr Codex опущен: там только ошибки запуска посторонних MCP-серверов пользователя, ошибок сервера `linear` нет. При воспроизведении образцов никакие вызовы к модели или Linear не выполняются.
