# pyright: reportMissingTypeArgument=false, reportUnknownParameterType=false

import subprocess
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Annotated, Any, Literal, cast

import click
import numpy as np
import pandas as pd
import rasterio
import tifffile
from anndata import AnnData
from rasterio.enums import Resampling
from rasterio.io import DatasetWriter

from loopy.utils import ReadonlyModel, Url

Meter = Annotated[float, "meter"]


class Coords(ReadonlyModel):
    x: int
    y: int


class SpotParams(ReadonlyModel):
    spotDiam: Meter = 65e-6
    mPerPx: float = 0.497e-6


class ImageParams(ReadonlyModel):
    urls: list[Url]
    headerUrl: Url


class ImageHeader(ReadonlyModel):
    sample: str
    coords: list[Coords]
    channel: dict[str, int]
    spot: SpotParams
    mode: Literal["composite", "rgb"]


def gen_header(
    vis: AnnData, sample: str, channels: dict[str, int], spot: SpotParams, is_rgb: bool = False
) -> ImageHeader:
    spatial = cast(pd.DataFrame, vis.obsm["spatial"])
    coords = pd.DataFrame(spatial, columns=["x", "y"], dtype="uint32")
    coords = [Coords(x=row.x, y=row.y) for row in coords.itertuples()]  # type: ignore

    return ImageHeader(
        sample=sample,
        coords=coords,
        channel=channels,
        spot=spot,
        mode="rgb" if is_rgb else "composite",
    )


def gen_geotiff(img: np.ndarray, path: Path, scale: float, rgb: bool = False) -> list[Path]:
    if rgb:
        z = img.shape[2]
        assert z == 3
        height = img.shape[0]
        width = img.shape[1]
    else:
        z = img.shape[0]
        height = img.shape[1]
        width = img.shape[2]

    if z < 4:
        names = ("",)
    elif z > 6:
        raise ValueError("Too many channels")
    else:
        names = ("_1", "_2")

    ps = [path.parent / (path.stem + x + ".tif_") for x in names]

    for i in range(len(names)):
        # Not compressing here since we cannot control compression level.
        dst: DatasetWriter
        with rasterio.open(
            ps[i],
            "w",
            driver="GTiff",
            height=height,
            width=width,
            count=3 if i == 0 else 4,
            photometric="RGB" if rgb else "MINISBLACK",
            transform=rasterio.Affine(
                scale, 0, 0, 0, -scale, 0
            ),  # https://gdal.org/tutorials/geotransforms_tut.html
            dtype=img.dtype,
            crs="EPSG:32648",  # meters
            tiled=True,
        ) as dst:  # type: ignore
            for j in range(3):
                idx = j + 3 * i
                dst.write(img[idx] if not rgb else img[:, :, idx], j + 1)
            dst.build_overviews([4, 8, 16, 32, 64], Resampling.nearest)
    return ps


def compress(ps: list[Path], quality: int = 90) -> None:
    try:
        with ThreadPoolExecutor() as executor:
            executor.map(
                lambda i: subprocess.run(
                    f"gdal_translate {ps[i].as_posix()} {ps[i].as_posix()[:-1]} -co TILED=YES -co COMPRESS=JPEG -co COPY_SRC_OVERVIEWS=YES -co JPEG_QUALITY={quality}",
                    shell=True,
                    capture_output=True,
                    text=True,
                    check=True,
                ),
                range(len(ps)),
            )
    except subprocess.CalledProcessError as e:
        print(e.output)
        raise e
    else:
        for p in ps:
            p.unlink()


@click.command()
@click.argument("tiff", nargs=1, type=click.Path(exists=True, dir_okay=False, path_type=Path))
@click.argument("outdir", nargs=1, type=click.Path(exists=True, file_okay=False, path_type=Path))
@click.option("--quality", default=90, help="JPEG compression quality")
@click.option("--scale", default=0.497e-6, help="Scale factor")
def run(tiff: Path, outdir: Path, quality: int = 90, scale: float = 0.497e-6) -> None:
    img: np.ndarray[Any, Any] = tifffile.imread(tiff)
    ps = gen_geotiff(img, outdir, scale)
    compress(ps, quality)


if __name__ == "__main__":
    run()
