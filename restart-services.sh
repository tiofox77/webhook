#!/bin/sh
# SuperLoja — wrapper do restart para contextos bash (Hermes, WSL, Git Bash).
# Delega tudo ao .cmd via cmd.exe para evitar a armadilha WSL-bash/caminhos /c/.
cmd.exe /c "C:\\superloja\\webhook-server\\restart-services.cmd"
