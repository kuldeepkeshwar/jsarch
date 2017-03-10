'use strict';

const YError = require('yerror');
const path = require('path');
const recast = require('recast');
const types = require('ast-types');
const ARCHITECTURE_NOTE_REGEXP =
  /^\s*Architecture Note #((?:\d+(?:\.(?=\d)|)){1,8}):\s+([^\r\n$]*)/;
const SHEBANG_REGEXP = /#! (\/\w+)+ node/;

/* Architecture Note #1.3: Title level

By default, titles will be added like if the architecture
 notes were in a single separated file.

If you wish to add the architecture notes in a README.md file
 you will have to set the `titleLevel` option to as much `#`
 as necessar to fit the title hierarchy of you README file.
*/
const TITLE_LEVEL = '#';


/* Architecture Note #1.4: Base

By default, links to the architecture notes right in the code
 are supposed relative to the README.md file like you would
 find it in the GitHub homepage of you projects.

To override it, use the `base` option.

*/
const BASE = '.';

module.exports = initJSArch;

/* Architecture Note #1: jsArch service

JSArch is basically a service that exposes a function allowing
 to extract and output architecture notes from the code.

This service needs some other services. To be able to mock and
 interchangethem, we use
 [Knifecycle](https://github.com/nfroidure/knifecycle) for its
 dependency injection and inversion of control feature.

![Dependencies Graph](./DEPENDENCIES.mmd.png)
*/

/**
 * Declare jsArch in the dependency injection system
 * @param  {Knifecycle} $                  The knifecycle instance
 * @param  {String} [name='jsArch']        The name of the service
 * @param  {Array}  [dependencies=['glob', 'fs', 'log']] The dependencies to inject
 * @returns {undefined}
 */
function initJSArch(
  $,
  name = 'jsArch',
  dependencies = ['EOL', 'glob', 'fs', 'log']
) {
  $.service(name,
    $.depends(dependencies,
      services => Promise.resolve(jsArch.bind(null, services))
    )
  );
}

/**
 * Compile an run a template
 * @param {Object}   services       Services (provided by the dependency injector)
 * @param {Object}   services.glob  Globbing service
 * @param {Object}   services.fs    File system service
 * @param {Object}   services.log   Logging service
 * @param {Object}   options        Options (destructured)
 * @param {Object}   options.cwd         Current working directory
 * @param {Object}   options.patterns    Patterns to look files for (see node-glob)
 * @return {String}                 Computed architecture notes
 */
function jsArch({
  EOL, glob, fs, log,
}, {
  cwd, patterns, eol,
  titleLevel = TITLE_LEVEL,
  base = BASE,
}) {
  eol = eol || EOL;
  return _computePatterns({ glob, log }, cwd, patterns)
  .then(files => Promise.all(
    files.map(_extractArchitectureNotes.bind(
      null,
      { fs, log }
    ))
  ))
  .then(_linearize)
  .then(architectureNotes =>
    architectureNotes
    .sort(_compareArchitectureNotes)
    .reduce(
      (content, architectureNote) =>
      content + eol + eol +
      titleLevel + architectureNote.num.split('.').map(() => '#').join('') +
      ' ' + architectureNote.title + eol + eol +
      architectureNote.content + eol + eol +
      '[See in context](' +
        base + '/' + path.relative(cwd, architectureNote.filePath) +
        '#L' + architectureNote.loc.start.line + '-L' + architectureNote.loc.end.line +
      ')' + eol + eol
      , '')
  )
  .then((content) => {
    if(content) {
      return titleLevel + ' Architecture Notes' + eol + eol + content;
    }
    return content;
  });
}

function _computePatterns({ glob, log }, cwd, patterns) {
  return Promise.all(patterns.map((pattern) => {
    log('debug', 'Processing pattern:', pattern);
    return glob(pattern, {
      cwd,
      dot: true,
      nodir: true,
      absolute: true,
    })
    .then((files) => {
      log('debug', 'Pattern sucessfully resolved', pattern);
      log('debug', 'Files:', files);
      return files;
    })
    .catch((err) => {
      log('error', 'Pattern failure:', pattern);
      log('stack', 'Stack:', err.stack);
      throw YError.wrap(err, 'E_PATTERN_FAILURE', pattern);
    });
  }))
  .then(_linearize);
}


/* Architecture Note #1.1: Extraction

We use AST parsing and visiting to retrieve well formed
architecture notes. It should be structured like that:
```js

/** Architecture Note #{order}: {title}

{body}
```
*/
function _extractArchitectureNotes({ fs, log }, filePath) {
  log('debug', 'Reading file at', filePath);
  return fs.readFileAsync(filePath, 'utf-8')
  .then((content) => {
    log('debug', 'File sucessfully read', filePath);
    return content;
  })
  .then(function _stripShebang(content) {
    if(SHEBANG_REGEXP.test(content)) {
      log('debug', 'Found a shebang, commenting it', filePath);
      content = '// Shebang commented by jsarch: ' + content;
    }
    return content;
  })
  .catch((err) => {
    log('error', 'File read failure:', filePath);
    log('stack', 'Stack:', err.stack);
    throw YError.wrap(err, 'E_FILE_FAILURE', filePath);
  })
  .then((content) => {
    const ast = recast.parse(content);
    const architectureNotes = [];

    types.visit(ast, {
      visitComment: function(path) {
        const comment = path.value.value;
        const matches = ARCHITECTURE_NOTE_REGEXP.exec(comment);

        if(matches) {
          architectureNotes.push({
            num: matches[1],
            title: matches[2].trim(),
            content: comment.substr(matches[0].length).trim(),
            filePath: filePath,
            loc: path.value.loc,
          });
        }
        this.traverse(path);
      },
    });

    return architectureNotes;
  })
  .then((architectureNotes) => {
    log('debug', 'File sucessfully processed', path);
    log(
      'debug',
      'Architecture notes found:',
      architectureNotes.map(a => a.title)
    );
    return architectureNotes;
  })
  .catch((err) => {
    log('error', 'File parse failure:', path);
    log('stack', 'Stack:', err.stack);
    throw YError.wrap(err, 'E_FILE_PARSE_FAILURE', path);
  });
}

function _linearize(bulks) {
  return bulks.reduce(
    (array, arrayBulk) =>
      array.concat(arrayBulk),
    []
  );
}

/* Architecture Note #1.2: Ordering

To order architecture notes in a meaningful way we
 use title hierarchy like we used too at school with
 argumentative texts ;).

A sample tree structure could be:
- 1
- 1.1
- 1.2
- 2
- 3

*/

function _compareArchitectureNotes(a, b) {
  const aTitleLevels = a.num.split('.').map(n => parseInt(n, 10));
  const bTitleLevels = b.num.split('.').map(n => parseInt(n, 10));
  let result = 0;

  result = aTitleLevels.reduce((curOrder, curALevel, index) => {
    if(0 !== curOrder) {
      return curOrder;
    }
    if('undefined' === typeof bTitleLevels[index]) {
      return 1;
    }
    if(curALevel > bTitleLevels[index]) {
      return 1;
    }
    if(curALevel < bTitleLevels[index]) {
      return -1;
    }
    return 0;
  }, result);
  return result;
}
