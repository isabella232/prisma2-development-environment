#!/bin/bash

set -ex

if [ "$DEVELOPMENT_ENVIRONMENT_COMMIT" ]; then
  git stash
  git checkout $DEVELOPMENT_ENVIRONMENT_COMMIT
fi

npm i -g pnpm
npm i -g yarn || echo "Ok"
yarn --version || echo "Ok"
pnpm i --frozen-lockfile=false

pnpm run setup

cd prisma/cli/prisma2
pnpm i --frozen-lockfile=false sqlite3@4.1.1 --unsafe-perm
cd ../../..

pnpm run test

echo "//registry.npmjs.org/:_authToken=${NPM_TOKEN}" > ~/.npmrc

pnpm run publish-all