---
title: Lupin in five minutes
description: From the download to your first test results and a verdict on whether quality got better or worse, in five steps.
---

# Lupin in five minutes

Five steps, each with how you know it worked. Most of the time is the first image download.

## 1. Start it

Install [Docker Desktop](https://docs.docker.com/get-docker/), download `lupin-<version>.zip` from
the [latest release](https://github.com/Sergey-Bar/Lupin/releases/latest), unzip it, and run the
start script in that folder:

| System            | Command                  |
| ----------------- | ------------------------ |
| Windows           | double-click `start.cmd` |
| macOS, Linux, WSL | `./start.sh`             |

**It worked when** the browser opens `http://localhost:8080`.

## 2. Check the machine

```sh
./start.sh doctor        # .\start.cmd doctor on Windows
```

Doctor checks Docker, the `.env` file, disk space, whether Lupin answers, and your backups. Each
line is `ok` or `FIX` with what to do. It changes nothing, so run it whenever something seems off.

**It worked when** every line is `ok`, except "No backup yet", which step 5 fixes.

## 3. Connect your project

Home opens the setup guide on a fresh install. Point it at a Git repository or a folder; Lupin
reads it and lists the test commands it found.

**It worked when** your project is listed with at least one command.

## 4. Send results

Either run a detected command from the **Runner** page, or send a report from your CI. Lupin
reads Playwright, JUnit, Jest, Vitest, pytest, Cypress, .NET (TRX, NUnit, xUnit), Cucumber,
Robot Framework, Go, Postman/Newman, k6, ZAP and Lighthouse; see
[Sending results](sending-results.md) for the command per tool.

**It worked when** the run shows on **Runs**, with its tests and failures.

## 5. Read the verdict, and back up

Home says whether this release is ready, with the reasons. What needs you, such as a failing run
or an offline runner, is listed under it with one action each. Whether quality got better or
worse since last week, with the one reason, is the quality pulse: ask your editor with the MCP
tool `get_pulse`, or read `GET /api/v1/projects/<id>/pulse`. "Unknown" means there is not enough
history yet; it fills in after a second week of results.

Then take your first backup:

```sh
./start.sh backup        # .\start.cmd backup on Windows
```

**It worked when** `./start.sh doctor` says "All good."

## Words you will see

Every term on the screens is in [Words explained](glossary.md).
