# Profile Workbench Regression Example

This example captures the first consumer dogfood failure that motivated Handoff-First
Linear Workflow v2.

The important regression is not "a heading changed." The regression is an agent
turning shaped discovery into implementation without first producing clean
Linear source-of-truth artifacts.

## Failure Captured

The bad path looked plausible in the moment:

1. `mono-idea` captured a real product improvement.
2. `/office-hours` shaped the product direction.
3. The agent produced PRD, Tech Spec, and Issue-like content.
4. The Project moved toward Delivery too early.
5. Linear-facing bodies leaked workflow language such as lifecycle notes,
   active-doc lists, skill names, and readiness instructions.
6. Implementation could begin from a local plan instead of an approved Linear
   Issue.

The fix is stronger artifact construction, not more template bureaucracy.

## Expected Lifecycle

- Project starts in Idea after `mono-idea`.
- Project moves to Discovery when PRD and Tech Spec are created.
- Project remains Discovery after PRD and Tech Spec creation.
- `mono-handoff` packages Project, PRD, Tech Spec, and proposed Issue slicing
  for user approval.
- Delivery starts through `mono-implement` and requires an approved execution
  Issue plus explicit implementation-start approval.
- Implementation starts from the approved Issue, not from `/office-hours`,
  `/brainstorming`, PRD, Tech Spec, or a local review plan.
- Local branch readiness is proven by `mono-preflight` before `mono-ship`
  owns formal pre-ship review/check and PR lifecycle.

## Good Project Fragment

The Project is a product brief, not a workflow dashboard.

```markdown
# Что

Переработать Settings > Operator Profile в Operator Profile Workbench для CRM:
три независимых save-блока, Roles через Add role modal, Service regions как
отдельная list-first поверхность.

# Зачем

Оператор сейчас откладывает правки профиля, потому что экран выглядит как одна
большая risky form. Профиль должен снова стать местом, которое спокойно
поддерживается вручную.

# Образ результата

Оператор меняет один раздел профиля и понимает, что именно будет сохранено.
Roles читаются как список, создание вынесено в modal, Service regions не
смешиваются с настройками доступа команды.

# Что входит

- Split saves для Identity, Notifications, Context.
- Roles list-first UI и Add role modal.
- Service regions list-first UI с названием и статусом.

# Что не входит

- Team-level permissions и схема организации.
- Role lifecycle beyond create/remove.
- Перенос контекста в отдельный экран команды.
```

## Good PRD Fragment

The PRD answers WHAT and gives stable requirement anchors.

```markdown
## Требования

**Безопасное редактирование профиля оператора**
- R1. Блоки Identity, Notifications и Context визуально и
  поведенчески являются отдельными save-поверхностями.
- R2. Сохранение одного блока профиля не отправляет unrelated fields из других
  блоков как null или empty updates.
- R3. У каждого блока профиля есть descriptive save copy: Save identity,
  Save notifications, Save context.

**Roles**
- R4. Roles отображаются как list-first поверхность.
- R5. Создание role открывается через Add role и не находится inline под
  списком.

**Service regions**
- R6. Service regions отображаются как список названий и статусов.
- R7. Текст региона не подразумевает командные права или схему организации.

## Примеры приемки

- AE1. Покрывает R1, R2, R3. Дано: existing profile с заполненными notifications
  и context fields. Когда оператор редактирует Identity и нажимает Save identity,
  тогда отправляются только identity-owned fields, а остальные profile fields
  остаются без изменений.
- AE2. Покрывает R4, R5. Дано: Roles card видима. Когда оператор нажимает Add
  role, тогда открывается modal с существующими create fields, а inline create
  form под списком отсутствует.
- AE3. Покрывает R6, R7. Дано: Service regions показаны. Когда регион неактивен,
  тогда UI показывает его статус и не связывает его с командными правами.

## Критерии успеха

- Оператор может внести одну небольшую правку профиля без ощущения, что будет
  переписан весь профиль.
- Tech Spec scope можно вывести без изобретения схемы командных прав.
```

## Good Tech Spec Fragment

The Tech Spec answers HOW and traces decisions back to PRD anchors.

```markdown
## Источник PRD

Поддерживает R1-R7 из PRD: Operator profile editing.

## Архитектура

Сохраняем существующие operator profile service и data model. Текущий широкий
save action разделяется на три server actions, каждая владеет только fields
своего блока.

Поддерживает R1, R2, R3.

## Контракты и границы

- Identity action владеет display name, handle, locale и avatar fields.
- Notifications action владеет email, mobile push и quiet-hours fields.
- Context action владеет background/context narrative fields.
- Roles и Service regions сохраняют существующую data shape.

Поддерживает R2, R4, R6.

## Валидация

- Unit tests покрывают partial FormData для каждой split action.
- Browser smoke подтверждает, что Save identity, Save notifications, Save context
  видимы, Add role открывает modal, а Service regions показывают название и статус.

Поддерживает AE1, AE2, AE3.
```

## Good Issue Links Shape

The Issue contains chips and resources, not copied documents.

```markdown
# Связи

<project id="project-profile-workbench">Operator profile editing</project>
<document id="prd-profile-workbench">PRD: Operator profile editing</document>
<document id="spec-profile-workbench">Tech Spec: Operator profile editing</document>
```

The Issue may also add PRD and Tech Spec as resources or links when the Linear
connector supports it. It must not attach PRD or Tech Spec documents to the
Issue itself.

## Bad Anti-Examples

Bad Project body:

```markdown
# Lifecycle

Status: Delivery.

# Документы

Active PRD: ...
Active Tech Spec: ...

# План задач

Run mono-check delivery, then create a PR.
```

Why it fails: Project body became a workflow dashboard.

Bad Tech Spec body:

```markdown
## Skill contracts

mono-check design must pass before mono-issue runs.
Move Project to Delivery after PRD and Tech Spec exist.
```

Why it fails: Tech Spec leaked agent workflow mechanics and wrong lifecycle
semantics.

Bad Issue body:

```markdown
# Связи

PRD: https://linear.app/example/document/raw-url
Tech Spec attached below as an Issue document.
```

Why it fails: chips/resources were available, but the Issue used raw URLs and
attached upstream documents.
