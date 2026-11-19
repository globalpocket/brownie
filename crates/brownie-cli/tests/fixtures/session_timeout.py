#!/usr/bin/python3
import os
import sys
import time
from pathlib import Path

for request in sys.stdin:
    if request.strip() == "warm":
        print(os.getpid(), flush=True)
        continue
    with Path(__file__).with_name("calls").open("a") as calls:
        calls.write("one\n")
    time.sleep(30)
