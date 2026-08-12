#!/bin/sh
set -e

npm run generate

exec "$@"
