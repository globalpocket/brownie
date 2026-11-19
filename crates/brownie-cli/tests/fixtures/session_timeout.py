#!/usr/bin/python3
import sys
import time
from pathlib import Path

for request in sys.stdin:
    if request.strip() == "warm":
        print("{}", flush=True)
        continue
    with Path(__file__).with_name("calls").open("a") as calls:
        calls.write("one\n")
    time.sleep(30)
