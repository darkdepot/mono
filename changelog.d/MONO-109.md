- MONO-109: install the pack once at wave end, after all registered tasks have
  landed and their workers stopped. Preserve merged-task records through failed
  installation and close each task with proof its merge is in the installed version.
