# Task registration while compact NOTE is selected (058)

Remove only the NOTE-specific visibility condition around TaskQuickAdd and its destination
label. All four compact tabs show the existing task input, registration button, and label.
No task registration behavior is changed: PROJECT uses the selected valid milestone;
THE DAY, INBOX and NOTE register a task in Inbox (projectId and milestoneId are null).

NOTE's + NEW NOTE remains independent and creates a note. The note sidebar, editor, width
restoration, keyboard tab switching and dirty guards are unchanged. No database, dependency,
IPC or application identity changes. The script runs typecheck/tests/build/diff-check and
commits only on success. Interactive NOTE registration verification remains necessary.
