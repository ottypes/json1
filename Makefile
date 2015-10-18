.PHONY: all watch

all:
	coffee -bco lib src

watch:
	coffee -wbco lib src
