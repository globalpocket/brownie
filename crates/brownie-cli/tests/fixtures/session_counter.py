#!/usr/bin/python3
import json
import os
import sys

for count, _ in enumerate(sys.stdin, start=1):
    print(json.dumps({"pid": os.getpid(), "n": count}), flush=True)
