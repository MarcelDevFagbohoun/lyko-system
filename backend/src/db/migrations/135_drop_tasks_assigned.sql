-- Audit sécurité/logique (2026-10-30, point 8) : `tasks_assigned` (migration 036) a été remplacée par
-- `planning_objectives`/`planning_key_results`/`planning_tasks` (migration 133, refonte Planning OKR +
-- Kanban + calendrier) — ses lignes ont été copiées une fois pour toutes vers `planning_tasks` à cette
-- occasion. Plus aucun code applicatif ne la lit ni ne l'écrit (`routes/tasks.js` lit désormais
-- `planning_tasks`) ; table vide confirmée avant suppression (0 ligne, tous tenants).
DROP TABLE IF EXISTS tasks_assigned;
