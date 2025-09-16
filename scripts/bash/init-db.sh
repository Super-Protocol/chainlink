#!/bin/bash
set -e

TOTAL_NODES="${1:-5}" # Принимаем количество нод из аргумента, по умолчанию 5
log() { echo "[init-db] $*"; }

# Переменные из env, можно переопределить
APP_DB_USER="${PGUSER:-chainlink}"
APP_DB_PASS="${PGPASSWORD:-chainlinkchainlink}"

# Инициализируем кластер БД, если директория данных пуста
if [ -z "$(ls -A "$PGDATA")" ]; then
    log "Initializing PostgreSQL database as user 'postgres'..."
    # ИСПРАВЛЕНИЕ: Запускаем initdb от имени пользователя postgres
    su - postgres -c "initdb -D \"$PGDATA\" --username=\"$POSTGRES_USER\""
fi

# Запускаем Postgres в фоновом режиме для выполнения команд
log "Starting temporary PostgreSQL server as user 'postgres'..."
# ИСПРАВЛЕНИЕ: Запускаем сам сервер от имени пользователя postgres
su - postgres -c "postgres -D \"$PGDATA\"" &
pid="$!"

# Ждем, пока сервер будет готов принимать подключения
until su - postgres -c "pg_isready -h localhost -p 5432 -U \"$POSTGRES_USER\""; do
  log "Waiting for PostgreSQL to start..."
  sleep 1
done
log "PostgreSQL is ready."

# Создаем пользователя для нод Chainlink, если его нет
# ИСПРАВЛЕНИЕ: Выполняем psql-запросы от имени пользователя postgres
if ! su - postgres -c "psql -t -c \"SELECT 1 FROM pg_roles WHERE rolname='$APP_DB_USER'\"" | grep -q 1; then
    log "Creating user $APP_DB_USER..."
    su - postgres -c "psql -c \"CREATE USER \\\"$APP_DB_USER\\\" WITH PASSWORD '$APP_DB_PASS';\""
else
    log "User $APP_DB_USER already exists."
fi

# Создаем базы данных для каждой ноды
for i in $(seq 1 "$TOTAL_NODES"); do
    DB_NAME="chainlink_node_${i}"
    # ИСПРАВЛЕНИЕ: Выполняем psql-запросы от имени пользователя postgres
    if su - postgres -c "psql -lqt | cut -d \| -f 1 | grep -qw \"$DB_NAME\""; then
        log "Database $DB_NAME already exists."
    else
        log "Creating database $DB_NAME..."
        su - postgres -c "createdb -O \"$APP_DB_USER\" \"$DB_NAME\""
    fi
done

# Останавливаем временный процесс Postgres
log "Stopping temporary PostgreSQL server..."
kill -SIGINT "$pid"
wait "$pid" || true
log "PostgreSQL initialization complete."
