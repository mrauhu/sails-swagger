import path from 'path'
import _ from 'lodash'
import Marlinspike from 'marlinspike'
import xfmr from '../../../lib/xfmr'
import jsdocParse from 'jsdoc-parse'
import es from 'event-stream'
import cbStream from 'callback-stream'

class Swagger extends Marlinspike {

  defaults (overrides) {
    return {
      'swagger': {
        pkg: {
          name: 'No package information',
          description: 'You should set sails.config.swagger.pkg to retrieve the content of the package.json file',
          version: '0.0.0'
        },
        ui: {
          url: 'http://localhost:8080/'
        },
        jsdoc: {
          path: ''
        }
      },
      'routes': {
        '/swagger/doc': {
          controller: 'SwaggerController',
          action: 'doc'
        }
      }
    };
  }

  constructor (sails) {
    super(sails, module);
  }

  initialize (next) {
    let hook = this.sails.hooks.swagger
    let apiJsDoc = null;

    this.sails.after('lifted', () => {
      hook.doc = xfmr.getSwagger(this.sails, this.sails.config.swagger.pkg, apiJsDoc)
    })

    if (this.sails.config.swagger.jsdoc.path) {
      var pipeEnd = cbStream(next);
      jsdocParse({src: this.sails.config.swagger.jsdoc.path})
          .pipe(es.map(function (jsDoc, cb) {
            try {
              apiJsDoc = JSON.parse(jsDoc);
              cb(null, apiJsDoc);
            } catch (err) {
              cb(err)
            }
          }))
          .pipe(pipeEnd)
    } else {
      next();
    }

  }
}

export default Marlinspike.createSailsHook(Swagger)
