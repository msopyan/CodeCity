/**
 * @license
 * Copyright 2018 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * @fileoverview Code utilities for Code City.
 * @author fraser@google.com (Neil Fraser)
 */

$.utils.code = {};

$.utils.code.parse = new 'CC.acorn.parse';
$.utils.code.parseExpressionAt = new 'CC.acorn.parseExpressionAt';

$.utils.code.toSource = function(value, opt_seen) {
  // Given an arbitrary value, produce a source code representation.
  // Primitive values are straightforward: "42", "'abc'", "false", etc.
  // Functions, RegExps, Dates, Arrays, and errors are returned as their
  // definitions.
  // Other objects and symbols are returned as selector expression.
  // Throws if a code representation can't be made.
  var type = typeof value;
  if (value === undefined || value === null ||
      type === 'number' || type === 'boolean') {
    if (Object.is(value, -0)) {
      return '-0';
    }
    return String(value);
  } else if (type === 'string') {
    return JSON.stringify(value);
  } else if (type === 'function') {
    return Function.prototype.toString.call(value);
  } else if (type === 'object') {
    // TODO: Replace opt_seen with Set, once available.
    if (opt_seen) {
      if (opt_seen.includes(value)) {
        throw new RangeError('[Recursive data structure]');
      }
      opt_seen.push(value);
    } else {
      opt_seen = [value];
    }
    var proto = Object.getPrototypeOf(value);
    if (proto === RegExp.prototype) {
      return String(value);
    } else if (proto === Date.prototype) {
      return 'Date(\'' + value.toJSON() + '\')';
    } else if (proto === Array.prototype && Array.isArray(value) &&
               value.length <= 100) {
      var props = Object.getOwnPropertyNames(value);
      var data = [];
      for (var i = 0; i < value.length; i++) {
        if (props.includes(String(i))) {
          try {
            data[i] = $.utils.code.toSource(value[i], opt_seen);
          } catch (e) {
            // Recursive data structure.  Bail.
            data = null;
            break;
          }
        } else {
          data[i] = '';
        }
      }
      if (data) {
        return '[' + data.join(', ') + ']';
      }
    } else if (value instanceof Error) {
      var constructor;
      if (proto === Error.prototype) {
        constructor = 'Error';
      } else if (proto === EvalError.prototype) {
        constructor = 'EvalError';
      } else if (proto === RangeError.prototype) {
        constructor = 'RangeError';
      } else if (proto === ReferenceError.prototype) {
        constructor = 'ReferenceError';
      } else if (proto === SyntaxError.prototype) {
        constructor = 'SyntaxError';
      } else if (proto === TypeError.prototype) {
        constructor = 'TypeError';
      } else if (proto === URIError.prototype) {
        constructor = 'URIError';
      } else if (proto === PermissionError.prototype) {
        constructor = 'PermissionError';
      }
      var msg;
      if (value.message === undefined) {
        msg = '';
      } else {
        try {
          msg = $.utils.code.toSource(value.message, opt_seen);
        } catch (e) {
          // Leave msg undefined.
        }
      }
      if (constructor && msg !== undefined) {
        return constructor + '(' + msg + ')';
      }
    }
  }
  if (type === 'object' || type === 'symbol') {
    var selector = $.utils.selector.getSelector(value);
    if (selector) {
      return selector;
    }
    throw new ReferenceError('[' + type + ' with no known selector]');
  }
  // Can't happen.
  throw new TypeError('[' + type + ']');
};

$.utils.code.toSource.processingError = false;

$.utils.code.toSourceSafe = function(value) {
  // Same as $.utils.code.toSource, but don't throw any selector errors.
  try {
    return $.utils.code.toSource(value);
  } catch (e) {
    if (e instanceof ReferenceError) {
      return e.message;
    }
    throw e;
  }
};

$.utils.code.rewriteForEval = function(src, forceExpression) {
  // Eval treats {} as an empty block (return value undefined).
  // Eval treats {'a': 1} as a syntax error.
  // Eval treats {a: 1} as block with a labeled statement (return value 1).
  // Detect these cases and enclose in parenthesis.
  // But don't mess with: {var x = 1; x + x;}
  // This is consistent with the console on Chrome and Node.
  // If 'forceExpression' is true, then throw a SyntaxError if the src is
  // more than one expression (e.g. '1; 2;').
  var ast = null;
  if (!forceExpression) {
    // Try to parse src as a program.
    try {
      ast = $.utils.code.parse(src);
    } catch (e) {
      // ast remains null.
    }
  }
  if (ast) {
    if (ast.type === 'Program' && ast.body.length === 1 &&
        ast.body[0].type === 'BlockStatement') {
      if (ast.body[0].body.length === 0) {
        // This is an empty object: {}
        return '({})';
      }
      if (ast.body[0].body.length === 1 &&
          ast.body[0].body[0].type === 'LabeledStatement' &&
          ast.body[0].body[0].body.type === 'ExpressionStatement') {
        // This is an unquoted object literal: {a: 1}
        // There might be a comment, so add a linebreak.
        return '(' + src + '\n)';
      }
    }
    return src;
  }
  // Try parsing src as an expression.
  // This may throw.
  ast = $.utils.code.parseExpressionAt(src, 0);
  var remainder = src.substring(ast.end).trim();
  if (remainder !== '') {
    // Remainder might legally include trailing comments or semicolons.
    // Remainder might illegally include more statements.
    var remainderAst = null;
    try {
      remainderAst = $.utils.code.parse(remainder);
    } catch (e) {
      // remainderAst remains null.
    }
    if (!remainderAst) {
      throw new SyntaxError('Syntax error beyond expression');
    }
    if (remainderAst.type !== 'Program') {
      throw new SyntaxError('Unexpected code beyond expression');  // Module?
    }
    // Trim off any unnecessary trailing semicolons.
    while (remainderAst.body[0] &&
           remainderAst.body[0].type === 'EmptyStatement') {
      remainderAst.body.shift();
    }
    if (remainderAst.body.length !== 0) {
      throw new SyntaxError('Only one expression expected');
    }
  }
  src = src.substring(0, ast.end);
  if (ast.type === 'ObjectExpression' || ast.type === 'FunctionExpression') {
    // {a: 1}  and function () {} both need to be wrapped in parens to avoid
    // being syntax errors.
    src = '(' + src + ')';
  }
  return src;
};

$.utils.code.rewriteForEval.unittest = function() {
  var cases = {
    // Input: [Expression, Statement(s)]
    '1 + 2': ['1 + 2', '1 + 2'],
    '2 + 3  // Comment': ['2 + 3', '2 + 3  // Comment'],
    '3 + 4;': ['3 + 4', '3 + 4;'],
    '4 + 5; 6 + 7': [SyntaxError, '4 + 5; 6 + 7'],
    '{}': ['({})', '({})'],
    '{}  // Comment': ['({})', '({})'],
    '{};': ['({})', '{};'],
    '{}; {}': [SyntaxError, '{}; {}'],
    '{"a": 1}': ['({"a": 1})', '({"a": 1})'],
    '{"a": 2}  // Comment': ['({"a": 2})', '({"a": 2})'],
    '{"a": 3};': ['({"a": 3})', '({"a": 3})'],
    '{"a": 4}; {"a": 4}': [SyntaxError, SyntaxError],
    '{b: 1}': ['({b: 1})', '({b: 1}\n)'],
    '{b: 2}  // Comment': ['({b: 2})', '({b: 2}  // Comment\n)'],
    '{b: 3};': ['({b: 3})', '{b: 3};'],
    '{b: 4}; {b: 4}': [SyntaxError, '{b: 4}; {b: 4}'],
    'function () {}': ['(function () {})', '(function () {})'],
    'function () {}  // Comment': ['(function () {})', '(function () {})'],
    'function () {};': ['(function () {})', '(function () {})'],
    'function () {}; function () {}': [SyntaxError, SyntaxError],
    '{} + []': ['{} + []', '{} + []']
  };
  var actual;
  for (var key in cases) {
    if (!cases.hasOwnProperty(key)) continue;
    // Test eval as an expression.
    try {
      actual = $.utils.code.rewriteForEval(key, true);
    } catch (e) {
      actual = SyntaxError;
    }
    if (actual !== cases[key][0]) {
      throw new Error('Eval Expression\n' +
                      'Expected: ' + cases[key][0] + ' Actual: ' + actual);
    }
    // Test eval as a statement.
    try {
      actual = $.utils.code.rewriteForEval(key, false);
    } catch (e) {
      actual = SyntaxError;
    }
    if (actual !== cases[key][1]) {
      throw new Error('Eval Statement\n' +
                      'Expected: ' + cases[key][1] + ' Actual: ' + actual);
    }
  }
};