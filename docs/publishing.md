# Публикация в Visual Studio Marketplace

Расширение расходится двумя каналами. GitHub Releases собираются сами: `release.yml` срабатывает на публикацию релиза, сверяет тег с `package.json` и прикладывает `.vsix`. Marketplace — отдельный ручной шаг, и он описан здесь. Почему так — в [ADR 0005](adr/0005-публикация-в-marketplace.md).

## Прежде чем публиковать первый раз

Публикация необратима в трёх местах, и узнать об этом лучше до, а не после.

- ID издателя и имя расширения резервируются навсегда в момент первой публикации.
- Номер версии после удаления переиспользовать нельзя, а последнюю версию удалить нельзя.
- `vsce unpublish` сохраняет статистику и оставляет расширение находимым через API; `vsce remove` необратим.

## Учётные данные

Публикация аутентифицируется Personal Access Token'ом Azure DevOps.

1. Организация Azure DevOps нужна обязательно: PAT выпускается внутри неё, даже если издатель создавался напрямую на `marketplace.visualstudio.com/manage`. Если организации нет — заведите её на https://dev.azure.com.
2. Токен создаётся в `https://dev.azure.com/{организация}/_usersSettings/tokens` → **New Token**.
3. **Organization** — `All accessible organizations`. Токен, ограниченный одной организацией, документация для публикации не описывает.
4. **Scopes** — `Custom defined` → `Show all scopes` → **Marketplace** → **Manage**. `Acquire` не нужен, он про установку расширений Azure DevOps, а не про публикацию.
5. Токен выпускается под той же учётной записью Microsoft, которой принадлежит издатель.

Дальше на выбор:

```sh
# Токен спросят один раз и положат в системный keychain — в истории команд его не будет.
npx vsce login PavlenkoEvgeny

# Либо на один запуск, без записи на диск. Значение при этом видно в истории
# команд и в списке процессов.
VSCE_PAT=<токен> npx vsce publish --packagePath ollama-balance-<version>.vsix
```

Явный `--pat` перекрывает `VSCE_PAT`; при `--oidc` переменная окружения игнорируется молча.

## Публикация

Релиз на GitHub уже собрал пакет, так что достаточно скачать его из ассетов и отдать `vsce`:

```sh
gh release download v<version> --pattern '*.vsix'
npx vsce publish --packagePath ollama-balance-<version>.vsix
```

В этом режиме `vsce` читает манифест **из самого VSIX** — издателя, имя и версию он берёт оттуда, а не из `package.json`, и вовсе его не открывает. Расхождение между `package.json` и упакованным манифестом поэтому не проверяется и не обнаруживается: авторитетен VSIX. Практическое следствие — собирать пакет надо из того же коммита, на который указывает тег.

Если версия уже занята, `vsce` откажется сам:

```
PavlenkoEvgeny.ollama-balance v1.1.3 already exists.
```

Повторный безопасный запуск — с `--skip-duplicate`: увидев, что версия опубликована, он молча завершится успешно.

## Проверка

```sh
code --install-extension PavlenkoEvgeny.ollama-balance
```

Листинг: https://marketplace.visualstudio.com/items?itemName=PavlenkoEvgeny.ollama-balance

## Откат

`npx vsce unpublish PavlenkoEvgeny.ollama-balance` снимает листинг, сохраняя статистику и оставляя расширение находимым через API. `npx vsce remove PavlenkoEvgeny.ollama-balance` удаляет всё и необратим. Отдельную версию тоже можно удалить, но её номер после этого не переиспользовать.

## Срок жизни PAT

Глобальные PAT Azure DevOps перестают работать для Marketplace **1 декабря 2026** — все, включая выпущенные незадолго до этой даты. Организационно-ограниченные токены под эту отставку не попадают, но пригодны ли они для публикации, документация не говорит: она описывает только глобальные.

Замена на 8 октября 2026: `vsce publish --oidc` (GitHub OIDC trusted publishing) уже есть в `@vscode/vsce` 4.0.0, но бэкенд Marketplace его ещё не поддерживает — `POST /_apis/gallery/token` отвечает `TrustedPublishingNotSupportedException`. Поэтому переезд делается не «на `--oidc`», а на первый из двух путей, который к тому моменту окажется рабочим: `--oidc`, если бэкенд доведут, иначе `vsce publish --azure-credential` (Entra ID, workload identity federation и managed identity) — этот путь живой, но требует ручной настройки в портале Azure.
