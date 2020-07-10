.PHONY: clean all dist/json1.release.js

#terser -m -d process.env.JSON1_RELEASE_MODE=true -c pure_funcs=log,keep_fargs=false,passes=2 --wrap fn < lib/json1.js

all: dist/json1.release.js

# Look, this isn't really necessary, but it allows me to add the RELEASE flag
# to the library and add a lot of additional (computationally + code size)
# expensive checks throughout transform which should otherwise be removed. In
# release mode we also remove some debugging output libraries which we don't
# want webpack/browserify to end up pulling in. This can shave off a nontrivial
# amount of space for the bundler.

# Basically what this is doing is hard-setting the RELEASE_MODE flag in the
# code so the minifier can elide all if(!RELEASE_MODE) {...} blocks.
# lib/json1.release.js: lib/json1.js
# 	npx terser -d process.env.JSON1_RELEASE_MODE=true -c pure_funcs=log,keep_fargs=false,passes=2 -b --ecma 7 -o $@ -- $< 

dist/json1.js: lib/json1.ts
	npx tsc
dist/json1.release.js: dist/json1.js
	npx terser -d process.env.JSON1_RELEASE_MODE=true -c pure_funcs=log,keep_fargs=false,passes=2 -b --ecma 7 -o $@ -- $< 


clean:
	rm -rf dist
