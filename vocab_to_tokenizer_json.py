#!/usr/bin/env python3

import sys
from transformers import AutoTokenizer

tokenizer = AutoTokenizer.from_pretrained(sys.argv[1])
tokenizer.save_pretrained(sys.argv[1])
