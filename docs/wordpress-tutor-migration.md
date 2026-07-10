# WordPress / Tutor LMS Migration

Дата последнего прогона: 2026-07-02.

## Источники

- SQL dump: `C:\Users\телеграм 8\Downloads\maritimelearning.sql`
- WordPress files: `C:\Users\телеграм 8\Downloads\maritimelearning.store`
- WordPress uploads: `C:\Users\телеграм 8\Downloads\maritimelearning.store\wp-content\uploads`
- Дополнительная папка video: `C:\Users\телеграм 8\Downloads\video`

## Что перенесено

- Студенты: 47
- Опубликованные курсы: 67
- Обложки курсов: 67
- Уроки: 138
- Материалы: 229
- Активные тесты: 44
- Вопросы тестов: 486
- Назначения курсов: 64
- Попытки тестов: 44

Импорт поддерживает вопросы Tutor LMS типов `single_choice`, `true_false` и `multiple_choice`.

## Что не переносилось автоматически

- 35 курсов не импортированы, потому что они были в статусах `trash`, `draft` или `pending`.
- Старые администраторы/служебные пользователи не импортированы как студенты.
- Старые сертификаты Tutor LMS пока не превращались в новые сертификаты LMS.
- Видео, обложки курсов и другие найденные файлы скопированы локально.

## Медиа

Импорт найденных материалов и обложек ссылается на 147 файлов общим размером около 56.28 GB.

В apply-прогоне с `--copy-files` обработано 146 файлов: 81 уже существовал локально и был пропущен, недостающие обложки курсов были скопированы. Материалы и обложки курсов используют локальные ссылки `/uploads/imported-wordpress/...`.

Осталось проверить вручную:

- 2 старых WordPress URL без расширения файла в `missing-media.json`.
- 1 фото студента `2026/06/1000056329-1.jpg`: оно есть в базе WordPress, но отсутствует в предоставленной копии файлов.

Команда, которой можно повторить импорт и копирование найденных файлов:

```powershell
cd "C:\Users\телеграм 8\Documents\LMS"
node scripts/import-wordpress-tutor.mjs --apply --copy-files
```

## Отчеты

Основные отчеты лежат здесь:

- `imports/wordpress/output/summary.json`
- `imports/wordpress/output/files.json`
- `imports/wordpress/output/missing-media.json`
- `imports/wordpress/output/skipped-courses.json`
- `imports/wordpress/output/skipped-users.json`
- `imports/wordpress/output/temporary-passwords.csv`

## Backup

Перед импортом был создан backup:

```text
C:\Users\телеграм 8\Documents\LMS\backups\2026-07-01T09-53-05-540Z
C:\Users\телеграм 8\Documents\LMS\backups\2026-07-02T11-39-51-776Z
```
