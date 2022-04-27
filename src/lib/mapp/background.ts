import type { Map } from 'ol';
import WebGLTileLayer, { type Style } from 'ol/layer/WebGLTile.js';
import GeoTIFF from 'ol/source/GeoTIFF.js';
import type { Image } from '../data/image';
import { Deferrable } from '../utils';
import type { ImageMode } from './imgControl';
import type { MapComponent } from './mapp';

export class Background extends Deferrable implements MapComponent {
  source?: GeoTIFF;
  layer?: WebGLTileLayer;
  mode?: 'composite' | 'rgb';
  mPerPx?: number;

  constructor() {
    super();
  }

  mount(): void {
    if (!this.layer) {
      this.layer = new WebGLTileLayer({});
    }
    this._deferred.resolve();
  }

  async update(map: Map, image: Image) {
    await image.promise;
    if (!this.layer) {
      this.layer = new WebGLTileLayer({});
    }
    if (this.source) {
      this.layer.getSource()?.dispose(); // Cannot reuse GeoTIFF.
    }

    const urls = image.urls.map((url) => ({ url: url.url }));
    this.source = new GeoTIFF({
      normalize: image.header!.mode === 'rgb',
      sources: urls
    });

    if (this.mode !== (image.header!.mode ?? 'composite')) {
      this.mode = image.header!.mode ?? 'composite';
      this.layer.setStyle(this._genBgStyle(this.mode));
    }
    this.mPerPx = image.header!.spot.mPerPx;
    this.layer.setSource(this.source);
    map.setView(this.source.getView());
  }

  updateStyle(variables: Record<string, number>) {
    this.layer?.updateStyleVariables(variables);
  }

  _genBgStyle(mode: ImageMode): Style {
    if (mode === 'composite') {
      return {
        variables: {
          blue: 1,
          green: 1,
          red: 1,
          blueMax: 128,
          greenMax: 128,
          redMax: 128,
          blueMask: 1,
          greenMask: 1,
          redMask: 1
        },
        color: [
          'array',
          ['*', ['/', ['band', ['var', 'red']], ['var', 'redMax']], ['var', 'redMask']],
          ['*', ['/', ['band', ['var', 'green']], ['var', 'greenMax']], ['var', 'greenMask']],
          ['*', ['/', ['band', ['var', 'blue']], ['var', 'blueMax']], ['var', 'blueMask']],
          1
        ]
      };
    } else {
      return {
        variables: {
          Exposure: 0,
          Contrast: 0,
          Saturation: 0
        },
        exposure: ['var', 'Exposure'],
        contrast: ['var', 'Contrast'],
        saturation: ['var', 'Saturation']
      };
    }
  }
}
