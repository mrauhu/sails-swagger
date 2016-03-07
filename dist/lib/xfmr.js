'use strict';

Object.defineProperty(exports, '__esModule', {
  value: true
});

var _slicedToArray = (function () { function sliceIterator(arr, i) { var _arr = []; var _n = true; var _d = false; var _e = undefined; try { for (var _i = arr[Symbol.iterator](), _s; !(_n = (_s = _i.next()).done); _n = true) { _arr.push(_s.value); if (i && _arr.length === i) break; } } catch (err) { _d = true; _e = err; } finally { try { if (!_n && _i['return']) _i['return'](); } finally { if (_d) throw _e; } } return _arr; } return function (arr, i) { if (Array.isArray(arr)) { return arr; } else if (Symbol.iterator in Object(arr)) { return sliceIterator(arr, i); } else { throw new TypeError('Invalid attempt to destructure non-iterable instance'); } }; })();

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { 'default': obj }; }

var _hoek = require('hoek');

var _hoek2 = _interopRequireDefault(_hoek);

var _lodash = require('lodash');

var _lodash2 = _interopRequireDefault(_lodash);

var _spec = require('./spec');

var _spec2 = _interopRequireDefault(_spec);

var _pluralize = require('pluralize');

var _pluralize2 = _interopRequireDefault(_pluralize);

var methodMap = {
  post: 'Create Object(s)',
  get: 'Read Object(s)',
  put: 'Update Object(s)',
  patch: 'Update Object(s)',
  'delete': 'Destroy Object(s)',
  options: 'Get Resource Options',
  head: 'Get Resource headers'
};

function getBlueprintPrefixes() {
  // Add a "/" to a prefix if it's missing
  function formatPrefix(prefix) {
    return (prefix.indexOf('/') !== 0 ? '/' : '') + prefix;
  }

  var prefixes = [];
  // Check if blueprints hook is not removed
  if (sails.config.blueprints) {
    if (sails.config.blueprints.prefix) {
      // Case of blueprints prefix
      prefixes.push(formatPrefix(sails.config.blueprints.prefix));
      if (sails.config.blueprints.rest && sails.config.blueprints.restPrefix) {
        // Case of blueprints prefix + rest prefix
        prefixes.unshift(prefixes[0] + formatPrefix(sails.config.blueprints.restPrefix));
      }
    } else if (sails.config.blueprints.rest && sails.config.blueprints.restPrefix) {
      // Case of rest prefix
      prefixes.push(formatPrefix(sails.config.blueprints.restPrefix));
    }
  }
  return prefixes;
}

var Transformer = {

  getSwagger: function getSwagger(sails, config, jsDoc) {
    var pkg = config.pkg;
    return {
      swagger: '2.0',
      info: Transformer.getInfo(pkg),
      host: sails.config.swagger.host,
      tags: Transformer.getTags(sails),
      definitions: Transformer.getDefinitions(sails),
      paths: Transformer.getPaths(sails, config, jsDoc)
    };
  },

  /**
   * Convert a package.json file into a Swagger Info Object
   * http://swagger.io/specification/#infoObject
   */
  getInfo: function getInfo(pkg) {
    return _hoek2['default'].transform(pkg, {
      'title': 'name',
      'description': 'description',
      'version': 'version',

      'contact.name': 'author',
      'contact.url': 'homepage',

      'license.name': 'license'
    });
  },

  /**
   * http://swagger.io/specification/#tagObject
   */
  getTags: function getTags(sails) {
    return _lodash2['default'].map(_lodash2['default'].pluck(sails.controllers, 'globalId'), function (tagName) {
      return {
        name: tagName
        //description: `${tagName} Controller`
      };
    });
  },

  /**
   * http://swagger.io/specification/#definitionsObject
   */
  getDefinitions: function getDefinitions(sails) {
    var definitions = _lodash2['default'].transform(sails.models, function (definitions, model, modelName) {
      definitions[model.identity] = {
        properties: Transformer.getDefinitionProperties(model.attributes)
      };
    });

    delete definitions['undefined'];

    return definitions;
  },

  getDefinitionProperties: function getDefinitionProperties(definition) {

    return _lodash2['default'].mapValues(definition, function (def, attrName) {
      var property = _lodash2['default'].pick(def, ['type', 'description', 'format', 'model']);

      /*
       * TODO: Add collection support maybe?
       */
      return property.model && sails.config.blueprints.populate ? { '$ref': Transformer.generateDefinitionReference(property.model) } : _spec2['default'].getPropertyType(property.type);
    });
  },

  /**
   * Convert the internal Sails route map into a Swagger Paths
   * Object
   * http://swagger.io/specification/#pathsObject
   * http://swagger.io/specification/#pathItemObject
   */
  getPaths: function getPaths(sails, config, jsDoc) {
    var routes = sails.router._privateRouter.routes;
    var pathGroups = _lodash2['default'].chain(routes).values().flatten().unique(function (route) {
      return route.path + route.method + JSON.stringify(route.keys);
    }).reject({ path: '/*' }).reject({ path: '/__getcookie' }).reject({ path: '/csrfToken' }).reject({ path: '/csrftoken' }).groupBy('path').value();

    pathGroups = _lodash2['default'].reduce(pathGroups, function (result, routes, path) {
      path = path.replace(/:(\w+)\??/g, '{$1}');
      if (result[path]) result[path] = _lodash2['default'].union(result[path], routes);else result[path] = routes;
      return result;
    }, []);

    return _lodash2['default'].mapValues(pathGroups, function (pathGroup) {
      return Transformer.getPathItem(sails, pathGroup, config, jsDoc);
    });
  },

  getModelFromPath: function getModelFromPath(sails, path) {
    var _path$split = path.split('/');

    var _path$split2 = _slicedToArray(_path$split, 5);

    var $ = _path$split2[0];
    var parentModelName = _path$split2[1];
    var parentId = _path$split2[2];
    var childAttributeName = _path$split2[3];
    var childId = _path$split2[4];

    var parentModel = sails.models[parentModelName] || parentModelName ? sails.models[_pluralize2['default'].singular(parentModelName)] : undefined;
    var childAttribute = _lodash2['default'].get(parentModel, ['attributes', childAttributeName]);
    var childModelName = _lodash2['default'].get(childAttribute, 'collection') || _lodash2['default'].get(childAttribute, 'model');
    var childModel = sails.models[childModelName] || childModelName ? sails.models[_pluralize2['default'].singular(childModelName)] : undefined;

    return childModel || parentModel;
  },

  getModelFromJsDoc: function getModelFromJsDoc(sails, doc, isRequest) {
    if (!doc.customTags) return;
    var modelTag = _lodash2['default'].find(doc.customTags, function (tag) {
      if (isRequest) {
        return tag.tag === 'request-model';
      } else {
        return tag.tag === 'response-model';
      }
    });
    if (!modelTag) return;
    var modelNameToFind = modelTag.value.toLowerCase();
    return _lodash2['default'].find(sails.models, function (model, modelName) {
      return modelName.toLowerCase() === modelNameToFind;
    });
  },

  getModelIdentityFromRoute: function getModelIdentityFromRoute(sails, modelGroup, jsDoc, isRequest) {
    var doc = Transformer.getJsDocFromRoute(sails, modelGroup, jsDoc);
    var model = null;
    if (doc) {
      model = Transformer.getModelFromJsDoc(sails, doc, isRequest);
    }
    if (!model) {
      model = Transformer.getModelFromPath(sails, modelGroup.path);
    }
    if (model) {
      return model.identity;
    }
  },

  /**
   * http://swagger.io/specification/#definitionsObject
   */
  getDefinitionReferenceFromRoute: function getDefinitionReferenceFromRoute(sails, methodGroup, jsDoc, isRequest) {
    var identity = Transformer.getModelIdentityFromRoute(sails, methodGroup, jsDoc, isRequest);
    if (identity) {
      return Transformer.generateDefinitionReference(identity);
    }
  },

  generateDefinitionReference: function generateDefinitionReference(modelIdentity) {
    return '#/definitions/' + modelIdentity;
  },

  /**
   * http://swagger.io/specification/#pathItemObject
   */
  getPathItem: function getPathItem(sails, pathGroup, config, jsDoc) {
    var methodGroups = _lodash2['default'].chain(pathGroup).indexBy('method').pick(['get', 'post', 'put', 'head', 'options', 'patch', 'delete']).value();

    return _lodash2['default'].mapValues(methodGroups, function (methodGroup, method) {
      return Transformer.getOperation(sails, methodGroup, method, config, jsDoc);
    });
  },

  /**
   * http://swagger.io/specification/#operationObject
   */
  getOperation: function getOperation(sails, methodGroup, method, config, jsDoc) {
    return {
      summary: Transformer.getPathSummary(sails, methodGroup, jsDoc) || methodMap[method],
      consumes: ['application/json'],
      produces: ['application/json'],
      externalDocs: Transformer.getExternalDocs(sails, methodGroup, jsDoc),
      description: Transformer.getPathDescription(sails, methodGroup, config, jsDoc),
      parameters: Transformer.getParameters(sails, methodGroup, jsDoc),
      responses: Transformer.getResponses(sails, methodGroup, jsDoc),
      tags: Transformer.getPathTags(sails, methodGroup, jsDoc)
    };
  },

  getPathDescription: function getPathDescription(sails, methodGroup, config, jsDoc) {
    var doc = Transformer.getJsDocFromRoute(sails, methodGroup, jsDoc);
    if (!doc) return;
    var desc = doc.description;
    /*
     * In Swagger-UI, the externalDocs for operation is not displayed properly.
     * If appendExtDocsToDesc is set to true, append the external docs to
     */
    if (config.jsdoc.appendExtDocsToDesc && _lodash2['default'].isArray(doc.see) && doc.see.length > 0) {
      desc += ' [External Document](' + doc.see[0] + ')';
    }
    return desc;
  },

  getExternalDocs: function getExternalDocs(sails, methodGroup, jsDoc) {
    var doc = Transformer.getJsDocFromRoute(sails, methodGroup, jsDoc);
    if (!doc || !_lodash2['default'].isArray(doc.see)) return;
    return {
      description: 'Find more here',
      url: doc.see[0]
    };
  },

  getPathSummary: function getPathSummary(sails, methodGroup, jsDoc) {
    var doc = Transformer.getJsDocFromRoute(sails, methodGroup, jsDoc);
    if (!doc) return;
    return doc.summary;
  },

  /**
   * A list of tags for API documentation control. Tags can be used for logical
   * grouping of operations by resources or any other qualifier.
   */
  getPathTags: function getPathTags(sails, methodGroup, jsDoc) {
    return _lodash2['default'].unique(_lodash2['default'].compact([Transformer.getPathModelTag(sails, methodGroup), Transformer.getJsDocModelTag(sails, methodGroup, jsDoc, true), Transformer.getJsDocModelTag(sails, methodGroup, jsDoc, false), Transformer.getPathControllerTag(sails, methodGroup), Transformer.getControllerFromRoute(sails, methodGroup)]));
  },

  getPathModelTag: function getPathModelTag(sails, methodGroup) {
    var model = Transformer.getModelFromPath(sails, methodGroup.path);
    return model && model.globalId;
  },

  getJsDocModelTag: function getJsDocModelTag(sails, methodGroup, jsDoc, isRequest) {
    var doc = Transformer.getJsDocFromRoute(sails, methodGroup, jsDoc);
    if (!doc) return;
    var model = Transformer.getModelFromJsDoc(sails, doc, isRequest);
    return model && model.globalId;
  },

  getPathControllerTag: function getPathControllerTag(sails, methodGroup) {
    // Fist check if we can find a controller tag using prefixed blueprint routes
    var _iteratorNormalCompletion = true;
    var _didIteratorError = false;
    var _iteratorError = undefined;

    try {
      for (var _iterator = getBlueprintPrefixes()[Symbol.iterator](), _step; !(_iteratorNormalCompletion = (_step = _iterator.next()).done); _iteratorNormalCompletion = true) {
        var prefix = _step.value;

        if (methodGroup.path.indexOf(prefix) === 0) {
          var _methodGroup$path$replace$split = methodGroup.path.replace(prefix, '').split('/');

          var _methodGroup$path$replace$split2 = _slicedToArray(_methodGroup$path$replace$split, 2);

          var _$ = _methodGroup$path$replace$split2[0];
          var _pathToken = _methodGroup$path$replace$split2[1];

          var tag = _lodash2['default'].get(sails.controllers, [_pathToken, 'globalId']);
          if (tag) return tag;
        }
      }
    } catch (err) {
      _didIteratorError = true;
      _iteratorError = err;
    } finally {
      try {
        if (!_iteratorNormalCompletion && _iterator['return']) {
          _iterator['return']();
        }
      } finally {
        if (_didIteratorError) {
          throw _iteratorError;
        }
      }
    }

    var _methodGroup$path$split = methodGroup.path.split('/');

    var _methodGroup$path$split2 = _slicedToArray(_methodGroup$path$split, 2);

    var $ = _methodGroup$path$split2[0];
    var pathToken = _methodGroup$path$split2[1];

    return _lodash2['default'].get(sails.controllers, [pathToken, 'globalId']);
  },

  getControllerFromRoute: function getControllerFromRoute(sails, methodGroup) {
    var route = Transformer.findRoute(sails, methodGroup);
    if (!route) return;

    var pattern = /(.+)Controller/;
    var controller = route.controller || _lodash2['default'].isString(route) && route.split('.')[0];

    if (!controller) return;

    var _Controller$exec = /(.+)Controller/.exec(controller);

    var _Controller$exec2 = _slicedToArray(_Controller$exec, 2);

    var $ = _Controller$exec2[0];
    var name = _Controller$exec2[1];

    return name;
  },

  findRoute: function findRoute(sails, methodGroup) {
    var pathToFind = (methodGroup.method + ' ' + methodGroup.path).toLowerCase();
    return _lodash2['default'].find(sails.config.routes, function (route, path) {
      return path.toLowerCase() === pathToFind;
    });
  },

  getJsDocFromRoute: function getJsDocFromRoute(sails, methodGroup, jsDoc) {
    if (!jsDoc) return;
    var pathToFind = (methodGroup.method + ' ' + methodGroup.path).toLowerCase();
    return _lodash2['default'].find(jsDoc, function (doc) {
      return doc.name.toLowerCase() === pathToFind;
    });
  },

  /**
   * http://swagger.io/specification/#parameterObject
   */
  getParameters: function getParameters(sails, methodGroup, jsDoc) {
    var method = methodGroup.method;
    var routeKeys = methodGroup.keys;

    var canHavePayload = method === 'post' || method === 'put';

    if (!routeKeys.length && !canHavePayload) return [];

    var parameters = _lodash2['default'].map(routeKeys, function (param) {
      return {
        name: param.name,
        'in': 'path',
        required: true,
        type: 'string'
      };
    });

    if (canHavePayload) {
      var modelIdentity = Transformer.getModelIdentityFromRoute(sails, methodGroup, jsDoc, true);

      if (modelIdentity) {
        parameters.push({
          name: modelIdentity,
          'in': 'body',
          required: false,
          schema: {
            $ref: Transformer.getDefinitionReferenceFromRoute(sails, methodGroup, jsDoc)
          }
        });
      }
    }

    return parameters;
  },

  /**
   * http://swagger.io/specification/#responsesObject
   */
  getResponses: function getResponses(sails, methodGroup, jsDoc) {
    var $ref = Transformer.getDefinitionReferenceFromRoute(sails, methodGroup, jsDoc, false);
    var ok = {
      description: 'The requested resource'
    };
    if ($ref) {
      ok.schema = { '$ref': $ref };
    }
    return {
      '200': ok,
      '404': { description: 'Resource not found' },
      '500': { description: 'Internal server error' }
    };
  }
};

exports['default'] = Transformer;
module.exports = exports['default'];