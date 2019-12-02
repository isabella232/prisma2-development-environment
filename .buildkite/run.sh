#!/bin/bash

set -ex

npm i -g pnpm
pnpm i
pnpm run setup

echo $RUN_PUBLISH
echo "Let's do it!"
pnpm run test

# cd prisma2/cli/sdk
# pnpm i
# pnpm run test
# ls
# cd ../../..

# pnpm test

# if [[ $RUN_PUBLISH]]; then
#   yarn publish --new-version $BUILDKITE_TAG --no-git-tag-version
# else
#   prisma2AlphaVersion=$(npm info prisma2 --tag alpha --json | jq .version)
#   prisma2AlphaVersion=$(./scripts/bump-version.js $prisma2AlphaVersion)
#   yarn publish --tag alpha --new-version $prisma2AlphaVersion  --no-git-tag-version
# fi