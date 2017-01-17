.PHONY: all watch

all:
	coffee -bco lib src
	cp src/*.js lib/

watch:
	coffee -wbco lib src
