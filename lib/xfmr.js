import hoek from 'hoek'
import _ from 'lodash'
import Spec from './spec'
import pluralize from 'pluralize'

const methodMap = {
  post: 'Create Object(s)',
  get: 'Read Object(s)',
  put: 'Update Object(s)',
  patch: 'Update Object(s)',
  delete: 'Destroy Object(s)',
  options: 'Get Resource Options',
  head: 'Get Resource headers'
}

function getBlueprintPrefixes() {
  // Add a "/" to a prefix if it's missing
  function formatPrefix(prefix) {
    return (prefix.indexOf('/') !== 0 ? '/' : '') + prefix
  }

  let prefixes = []
  // Check if blueprints hook is not removed
  if (sails.config.blueprints) {
    if (sails.config.blueprints.prefix) {
      // Case of blueprints prefix
      prefixes.push(formatPrefix(sails.config.blueprints.prefix))
      if (sails.config.blueprints.rest && sails.config.blueprints.restPrefix) {
        // Case of blueprints prefix + rest prefix
        prefixes.unshift(prefixes[0] + formatPrefix(sails.config.blueprints.restPrefix))
      }
    } else if (sails.config.blueprints.rest && sails.config.blueprints.restPrefix) {
      // Case of rest prefix
      prefixes.push(formatPrefix(sails.config.blueprints.restPrefix))
    }
  }
  return prefixes
}

const Transformer = {

  getSwagger (sails, pkg, jsDoc) {
    return {
      swagger: '2.0',
      info: Transformer.getInfo(pkg),
      host: sails.config.swagger.host,
      tags: Transformer.getTags(sails),
      definitions: Transformer.getDefinitions(sails),
      paths: Transformer.getPaths(sails, jsDoc)
    }
  },

  /**
   * Convert a package.json file into a Swagger Info Object
   * http://swagger.io/specification/#infoObject
   */
  getInfo (pkg) {
    return hoek.transform(pkg, {
      'title': 'name',
      'description': 'description',
      'version': 'version',

      'contact.name': 'author',
      'contact.url': 'homepage',

      'license.name': 'license'
    })
  },

  /**
   * http://swagger.io/specification/#tagObject
   */
  getTags (sails) {
    return _.map(_.pluck(sails.controllers, 'globalId'), tagName => {
      return {
        name: tagName
        //description: `${tagName} Controller`
      }
    })
  },

  /**
   * http://swagger.io/specification/#definitionsObject
   */
  getDefinitions (sails) {
    let definitions = _.transform(sails.models, (definitions, model, modelName) => {
      definitions[model.identity] = {
        properties: Transformer.getDefinitionProperties(model.definition)
      }
    })

    delete definitions['undefined']

    return definitions
  },

  getDefinitionProperties (definition) {

    return _.mapValues(definition, (def, attrName) => {
      let property = _.pick(def, [
        'type', 'description', 'format', 'model'
      ])

      return property.model && sails.config.blueprints.populate
          ? { '$ref': Transformer.generateDefinitionReference(property.model)}
          : Spec.getPropertyType(property.type)
    })
  },

  /**
   * Convert the internal Sails route map into a Swagger Paths
   * Object
   * http://swagger.io/specification/#pathsObject
   * http://swagger.io/specification/#pathItemObject
   */
  getPaths (sails, jsDoc) {
    let routes = sails.router._privateRouter.routes
    let pathGroups = _.chain(routes)
      .values()
      .flatten()
      .unique(route => {
        return route.path + route.method + JSON.stringify(route.keys)
      })
      .reject({ path: '/*' })
      .reject({ path: '/__getcookie' })
      .reject({ path: '/csrfToken' })
      .reject({ path: '/csrftoken' })
      .groupBy('path')
      .value()

    pathGroups = _.reduce(pathGroups, function(result, routes, path) {
      path = path.replace(/:(\w+)\??/g, '{$1}')
      if (result[path])
        result[path] = _.union(result[path], routes)
      else
        result[path] = routes
      return result
    }, [])

    return _.mapValues(pathGroups, pathGroup => {
      return Transformer.getPathItem(sails, pathGroup, jsDoc)
    })
  },

  getModelFromPath (sails, path) {
    let [ $, parentModelName, parentId, childAttributeName, childId ] = path.split('/')
    let parentModel = sails.models[parentModelName] || parentModelName ? sails.models[pluralize.singular(parentModelName)] : undefined
    let childAttribute = _.get(parentModel, [ 'attributes', childAttributeName ])
    let childModelName = _.get(childAttribute, 'collection') || _.get(childAttribute, 'model')
    let childModel = sails.models[childModelName] || childModelName ? sails.models[pluralize.singular(childModelName)] : undefined

    return childModel || parentModel
  },

  getModelIdentityFromPath (sails, path) {
    let model = Transformer.getModelFromPath(sails, path)
    if (model) {
      return model.identity
    }
  },

  /**
   * http://swagger.io/specification/#definitionsObject
   */
  getDefinitionReferenceFromPath (sails, path) {
    let model = Transformer.getModelFromPath(sails, path)
    if (model) {
      return Transformer.generateDefinitionReference(model.identity)
    }
  },

  generateDefinitionReference (modelIdentity) {
    return '#/definitions/' + modelIdentity
  },

  /**
   * http://swagger.io/specification/#pathItemObject
   */
  getPathItem (sails, pathGroup, jsDoc) {
    let methodGroups = _.chain(pathGroup)
      .indexBy('method')
      .pick([
        'get', 'post', 'put', 'head', 'options', 'patch', 'delete'
      ])
      .value()

    return _.mapValues(methodGroups, (methodGroup, method) => {
      return Transformer.getOperation(sails, methodGroup, method, jsDoc)
    })
  },

  /**
   * http://swagger.io/specification/#operationObject
   */
  getOperation (sails, methodGroup, method, jsDoc) {
    return {
      summary: Transformer.getPathSummary(sails, methodGroup, jsDoc) || methodMap[method],
      consumes: [ 'application/json' ],
      produces: [ 'application/json' ],
      description: Transformer.getPathDescription(sails, methodGroup, jsDoc),
      parameters: Transformer.getParameters(sails, methodGroup),
      responses: Transformer.getResponses(sails, methodGroup),
      tags: Transformer.getPathTags(sails, methodGroup)
    }
  },

  getPathDescription(sails, methodGroup, jsDoc){
    let doc = Transformer.getJsDocFromRoute(sails, methodGroup, jsDoc);
    if (!doc) return;
    return doc.description;
  },

  getPathSummary(sails, methodGroup, jsDoc){
    let doc = Transformer.getJsDocFromRoute(sails, methodGroup, jsDoc);
    if (!doc) return;
    return doc.summary;
  },

  /**
   * A list of tags for API documentation control. Tags can be used for logical
   * grouping of operations by resources or any other qualifier.
   */
  getPathTags (sails, methodGroup) {
    return _.unique(_.compact([
      Transformer.getPathModelTag(sails, methodGroup),
      Transformer.getPathControllerTag(sails, methodGroup),
      Transformer.getControllerFromRoute(sails, methodGroup)
    ]))
  },

  getPathModelTag (sails, methodGroup) {
    let model = Transformer.getModelFromPath(sails, methodGroup.path)
    return model && model.globalId
  },

  getPathControllerTag (sails, methodGroup) {
    // Fist check if we can find a controller tag using prefixed blueprint routes
    for (var prefix of getBlueprintPrefixes()) {
      if (methodGroup.path.indexOf(prefix) === 0) {
        let [ $, pathToken ] = methodGroup.path.replace(prefix, '').split('/')
        let tag = _.get(sails.controllers, [ pathToken, 'globalId' ])
        if (tag) return tag
      }
    }

    let [ $, pathToken ] = methodGroup.path.split('/')
    return _.get(sails.controllers, [ pathToken, 'globalId' ])
  },

  getControllerFromRoute (sails, methodGroup) {
    let route = Transformer.findRoute(sails, methodGroup)
    if (!route) return

    let pattern = /(.+)Controller/
    let controller = route.controller || (_.isString(route) && route.split('.')[0])

    if (!controller) return

    let [ $, name ] = /(.+)Controller/.exec(controller)

    return name
  },

  findRoute(sails, methodGroup){
    let pathToFind = `${methodGroup.method} ${methodGroup.path}`.toLowerCase()
    return _.find(sails.config.routes, function (route, path) {
      return path.toLowerCase() === pathToFind;
    })
  },

  getJsDocFromRoute(sails, methodGroup, jsDoc){
    if (!jsDoc) return;
    let pathToFind = `${methodGroup.method} ${methodGroup.path}`.toLowerCase()
    return _.find(jsDoc, function (doc) {
      return doc.name.toLowerCase() === pathToFind;
    });
  },

  /**
   * http://swagger.io/specification/#parameterObject
   */
  getParameters (sails, methodGroup) {
    let method = methodGroup.method
    let routeKeys= methodGroup.keys

    let canHavePayload = method === 'post' || method === 'put'

    if (!routeKeys.length && !canHavePayload) return []

    let parameters = _.map(routeKeys, param => {
      return {
        name: param.name,
        in: 'path',
        required: true,
        type: 'string'
      }
    })

    if (canHavePayload) {
      let path = methodGroup.path
      let modelIdentity = Transformer.getModelIdentityFromPath(sails, path)

      if (modelIdentity) {
        parameters.push({
          name: modelIdentity,
          in: 'body',
          required: true,
          schema: {
            $ref: Transformer.getDefinitionReferenceFromPath(sails, path)
          }
        })
      }
    }

    return parameters
  },

  /**
   * http://swagger.io/specification/#responsesObject
   */
  getResponses (sails, methodGroup) {
    let $ref = Transformer.getDefinitionReferenceFromPath(sails, methodGroup.path)
    let ok = {
      description: 'The requested resource'
    }
    if ($ref) {
      ok.schema = { '$ref': $ref }
    }
    return {
      '200': ok,
      '404': { description: 'Resource not found' },
      '500': { description: 'Internal server error' }
    }
  }
}

export default Transformer
