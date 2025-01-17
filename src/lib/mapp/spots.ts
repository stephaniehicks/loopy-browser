import type { Map } from 'ol';
import Feature from 'ol/Feature.js';
import { Circle, Point } from 'ol/geom.js';
import VectorLayer from 'ol/layer/Vector.js';
import WebGLPointsLayer from 'ol/layer/WebGLPoints.js';
import VectorSource from 'ol/source/Vector.js';
import { Stroke, Style } from 'ol/style.js';
import type { LiteralStyle } from 'ol/style/literal';
import { tableau10arr } from '../colors';
import { convertCategoricalToNumber } from '../data/dataHandlers';
import type { SpotParams } from '../data/image';
import { Deferrable } from '../utils';
import type { MapComponent, Mapp } from './mapp';

export class WebGLSpots extends Deferrable implements MapComponent {
  readonly source: VectorSource<Point>;
  layer?: WebGLPointsLayer<typeof this.source>;

  _currDataType?: 'categorical' | 'quantitative';
  _currSpotDiam?: number;
  _currMperPx?: number;
  _currMap?: Map;

  constructor() {
    super();
    this.source = new VectorSource({ features: [] });
  }

  mount(): void {
    this.layer = new WebGLPointsLayer({
      source: this.source,
      // Placeholder
      style: { symbol: { size: 12, symbolType: 'circle' } },
      zIndex: 10
    });
    this._deferred.resolve();
  }

  async updateIntensity(
    map: Mapp,
    intensity: number[] | string[] | Promise<number[] | string[]>,
    dataType: 'quantitative' | 'categorical'
  ) {
    await map.promise;
    if (!intensity) throw new Error('No intensity provided');
    if (intensity instanceof Promise) {
      intensity = await intensity;
    }

    if (intensity?.length !== this.source?.getFeatures().length) {
      console.error("Intensity length doesn't match");
      return false;
    }

    if (typeof intensity[0] === 'string') {
      ({ converted: intensity } = convertCategoricalToNumber(intensity));
    }

    for (let i = 0; i < intensity.length; i++) {
      this.source.getFeatureById(i)?.setProperties({ value: intensity[i] });
    }

    if (dataType !== this._currDataType && this._currMap) {
      this._currDataType = dataType;
      this.rebuildLayer(this._currMap, dataType, this._currSpotDiam!, this._currMperPx!);
    }
  }

  rebuildLayer(
    map: Map,
    dataType: 'quantitative' | 'categorical',
    spotDiam: number,
    mPerPx: number
  ) {
    const spotSize = spotDiam / mPerPx;
    const newLayer = new WebGLPointsLayer({
      source: this.source,
      style: this.genStyle(dataType, spotSize),
      zIndex: 10
    });

    const prev = this.layer;
    map.addLayer(newLayer);
    if (prev) {
      map.removeLayer(prev);
      prev.dispose();
    }
    this.layer = newLayer;
  }

  update(map: Map, coords: readonly { x: number; y: number }[], spotDiam: number, mPerPx: number) {
    this.rebuildLayer(map, 'quantitative', spotDiam, mPerPx);
    this._currSpotDiam = spotDiam;
    this._currMperPx = mPerPx;
    this._currMap = map;

    this.source.clear();
    this.source.addFeatures(
      coords.map(({ x, y }, i) => {
        const f = new Feature({
          geometry: new Point([x * mPerPx, -y * mPerPx]),
          value: 0,
          id: i
        });
        f.setId(i);
        return f;
      })
    );
  }

  genStyle(type: 'quantitative' | 'categorical', spotPx: number): LiteralStyle {
    const common = {
      symbolType: 'circle',
      size: [
        'interpolate',
        ['exponential', 2],
        ['zoom'],
        1,
        spotPx / 32,
        2,
        spotPx / 16,
        3,
        spotPx / 8,
        4,
        spotPx / 4,
        5,
        spotPx
      ]
    };

    if (type === 'quantitative') {
      return {
        variables: { opacity: 0.9 },
        symbol: {
          ...common,
          color: '#fce652ff',
          // color: ['interpolate', ['linear'], ['get', rna], 0, '#00000000', 8, '#fce652ff'],
          opacity: ['clamp', ['*', ['var', 'opacity'], ['/', ['get', 'value'], 5]], 0.1, 1]
          // opacity: ['clamp', ['var', 'opacity'], 0.05, 1]
        }
      };
    } else {
      const colors = [];
      for (let i = 0; i < tableau10arr.length; i++) {
        colors.push(['==', ['%', ['get', 'value'], tableau10arr.length], i], tableau10arr[i]);
      }
      return {
        variables: { opacity: 0.9 },
        symbol: {
          ...common,
          color: ['case', ...colors, '#ffffff'],
          opacity: ['clamp', ['var', 'opacity'], 0.1, 1]
        }
      };
    }
  }
}

export class ActiveSpots extends Deferrable implements MapComponent {
  readonly source: VectorSource<Circle>;
  readonly layer: VectorLayer<typeof this.source>;
  readonly feature: Feature<Circle>;

  constructor(style: Style = new Style({ stroke: new Stroke({ color: '#ffffff', width: 1 }) })) {
    super();
    this.feature = new Feature({
      geometry: new Circle([0, 0]),
      value: 0
    });
    this.source = new VectorSource({
      features: [this.feature]
    });
    this.layer = new VectorLayer({
      source: this.source,
      zIndex: 50,
      style
    });
  }

  mount(): void {
    this._deferred.resolve();
  }

  update({ x, y }: { x: number; y: number }, sp: SpotParams) {
    this.feature
      .getGeometry()
      ?.setCenterAndRadius([x * sp.mPerPx, -y * sp.mPerPx], sp.spotDiam / 2);
  }
}
