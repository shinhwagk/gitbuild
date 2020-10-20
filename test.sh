#!/usr/bin/env bash

mkdir -p /tmp/test/
cd /tmp/test/
git init

mkdir -p /tmp/test/image/1.0.0
echo  'FROM python:3' > /tmp/test/image/1.0.0/Dockerfile
mkdir -p /tmp/test/image/1.0.1
touch 'FROM python:3' > /tmp/test/image/1.0.1/Dockerfile
touch a > /tmp/test/image/1.0.1/c

git add -A && git commit -m "save"
deno run --allow-env --allow-read --allow-run --allow-net /workspaces/gitbuild/app.ts /tmp/test image


