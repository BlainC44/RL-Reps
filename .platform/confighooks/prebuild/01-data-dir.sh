#!/bin/bash
# Keep user accounts and progress outside the app folder, so they survive
# redeploys (Elastic Beanstalk replaces /var/app/current on every deploy).
set -euo pipefail
mkdir -p /var/app/rlreps-data
chown -R webapp:webapp /var/app/rlreps-data
chmod 700 /var/app/rlreps-data
