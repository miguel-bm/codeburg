# Codeburg Brainstorming

This are my unorganized thoughts on the project, as they come to me. To be organized later.

## Ideas for the app

- Codeburg is a personal project. A system to help me build code projects leveraging AI agents. However, it might eventually become something that could be used by others, or even build a OSS project or a SaaS project.
- The need comes from my workflow having been altered by the advent of code agents, such as Cursor, Claude Code, Codex, OpenCode, etc.
- I find that my workflow with them is lacking, and this project is an attempt to fix that.
- General idea is: have a remote dev environment for my projects + a project management software (kanban etc) + a way to manage code agents working on tasks
- I would have some platform where I can see all my projects or import new ones from Github etc. I can plan the project through creating tasks in the platform (epics, subtasks, dependencies etc would be nice maybe). Each task when moved to "In Progress" would create a new dev container in a new branch in my remote dev machine where codeburg is installed. I would then be able to spawn code agents to work on the task, or connect through an IDE to work on it myself. 
- Each project would need a way to configure its dev container.
- Not all tasks would need a dev container perhaps, some might be investigating, analytics, etc. Dev container would be an option, but common, one of the main features.
- Within a task I can spawn code agents to work on it, such as Claude Code or Codex. Ideally we would have an unified UI to manage that conversation: see what it's doing, send user messages, see code diff, explore files, get links to what files it's exploring or editing, etc. 
- Most importantly, when the code agent needs my input because it has finished generating its "turn", codeburg should know that and let me know (optional notifications, but at a minimum see something on the task card).
- It is also important that each task can spawn multiple code agent conversations if needed.
- Once ready, codeburg UI should also provide an easy way to commit changes, create a PR for the task etc.
- It would be nice to have some sort of shortcut to spawn a code agent to solve merge conflicts.
- It would be nice to have a shortcut to spawn a code agent to answer some question about the codebas.
- It would be nice to have a shortcut to create commit messages and PR descriptions with AI
- Since this is a remote dev environment, it is important that I can forward ports of any spawned dev servers through some URL. Either needing tailscale, or perhaps to some undiscoverable URL.
- A key in the kanban view is to be able to see all projects at once, and thus know which tasks from any project require attention.
- An obvious thing is that task descriptions can get added to the code agent context automatically.
- Would also be cool to be able to invite collaborators into the system
- One of the most important aspects that I haven't mentioned yet is that this should enable me to "code" from my phone through the codeburg platform. Initially a web app, or a telegram we app (bot + authenticated webapp is a nice combo)
- Exposing a bot (like a telegram bot) for the platform should allow me to meta control the projects through an LLM controlling the bot which is able to run commands on the platform, like creating tasks, polling in progress task state, answering things in my behalf, etc.
- I could also create an MCP for the platform, and an API. Very important that this be easily composable
- Of course I will build this system with AI agents. So the UI and any CRUD does not worry me, it's cheap to develop. I should build my own for this because I might need the flexibility. But for other things, I need available solutions:
  - dev container solution. I cannot build this myself in a reasonable timeframe, I need to use an available solution.
  - of course things like git, databases, ssh I will make use of available solutions.
  - code agents. I could build my own, but it's cheaper to operate claude code through the subscription than raw dog it with API pricing. Same for Codex I think.
  - any integrated file explorer/viewer/editor and diff viewer if we end up having that.

## Open questions / decisions to be made / things to explore

- What to use for dev containers? Inspiration in Coder, devpod
- How to make my own UI for the claude code / codex etc agents. Normally these either have their own UI, or use a terminal based UI. I can always spawn remote terminals and use the code agents through that, but that will be cumbersome and I'll have connection issues for long lived sessions I expect... There are thrird party UIs out there so it must be possible, but I don't know yet how they do it. taskyou, claudecodeui, overseer
- Obviously some part of the system should run in my home server. But should ALL of it run there? Should I have an independent platform that can connect to multiple servers? Or should all of it run in one place? Should it run in one place as independent services? Should I self-host everything, or have the UI part in Cloudflare Workers, and take advantage of D1/KV etc?
- What to use as a database? Things we need to store: the dev container configuration, the project data (tasks etc), status of those tasks including code agents spawned, project data like the git origin, and I think I'm missing some stuff for sure
- Some things I can think of for this database:
  - in the repo itself. This seems elegant at first glance, but it might not be the best
  - in the filesystem as JSONs and YAMLs and all that. Probably better for some things, but not for all.
  - a standalone database. Some options: SQLite, Postgres, MySQL, D1, Supabase, etc.
  - combinations of the above, depending on the specific use case.
- How to handle authentication? Telegram provides its own very simple solution, but I'd like to access through a normal browser too. Google login is probably great to have. But also just simply hardocded email and password is probably enough to start with, MVP should be purely personal.

## MVP definition

- Purely personal. No need to enable collaborators or have this be software that anyone can set up for themselves.
- Support one code agent (claude code to start with)
- Project management just means a kanban board
- Github integration
