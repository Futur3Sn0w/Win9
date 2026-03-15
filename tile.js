/**
 * TileJs - 3D Perspective Tilt Animation for Tiles
 * Based on: https://github.com/tholman/tileJs
 */

function Tile(element) {
    var tile = element;
    var resetTransform = "perspective(800px) rotateX(0deg) rotateY(0deg) translateZ(0px)";

    var init = function () {
        // Set transform origin to center
        tile.style.webkitTransformOrigin = "50% 50%";
        tile.style.MozTransformOrigin = "50% 50%";
        tile.style.msTransformOrigin = "50% 50%";
        tile.style.oTransformOrigin = "50% 50%";
        tile.style.transformOrigin = "50% 50%";

        // Set parent transform style
        if (tile.parentElement) {
            tile.parentElement.style.webkitTransformStyle = "preserve-3d";
            tile.parentElement.style.MozTransformStyle = "preserve-3d";
            tile.parentElement.style.msTransformStyle = "preserve-3d";
            tile.parentElement.style.oTransformStyle = "preserve-3d";
            tile.parentElement.style.transformStyle = "preserve-3d";
        }

        // Set transition
        tile.style.webkitTransition = "-webkit-transform 0.1s";
        tile.style.MozTransition = "-moz-transform 0.1s";
        tile.style.msTransition = "-ms-transform 0.1s";
        tile.style.oTransition = "-o-transform 0.1s";
        tile.style.transition = "transform 0.1s";

        tile.style.outline = "1px solid transparent";
        tile.style.webkitFontSmoothing = "antialiased";

        // Add mousedown event
        tile.addEventListener("mousedown", onMouseDown, false);
        tile.addEventListener("touchstart", onTouchStart, false);
    };

    var clickStartTime = 0;
    var clickStartPos = { x: 0, y: 0 };

    var applyTransform = function (x, y) {
        var width = tile.offsetWidth;
        var height = tile.offsetHeight;
        var transform = "perspective(800px) ";

        // Center zone - press down
        if (x > width / 4 && x < (width / 4 * 3) && y > height / 4 && y < (height / 4 * 3)) {
            transform += "rotateX(0deg) rotateY(0deg) translateZ(-30px)";
        } else {
            // Edge zones - tilt based on which edge is closer
            if (Math.min(x, width - x) < Math.min(y, height - y)) {
                // Left or right edge
                if (x < width - x) {
                    transform += "rotateX(0deg) rotateY(-15deg) translateZ(0px)";
                } else {
                    transform += "rotateX(0deg) rotateY(15deg) translateZ(0px)";
                }
            } else {
                // Top or bottom edge
                if (y < height - y) {
                    transform += "rotateX(15deg) rotateY(0deg) translateZ(0px)";
                } else {
                    transform += "rotateX(-15deg) rotateY(0deg) translateZ(0px)";
                }
            }
        }

        tile.style.webkitTransform = transform;
        tile.style.MozTransform = transform;
        tile.style.msTransform = transform;
        tile.style.oTransform = transform;
        tile.style.transform = transform;

        // Add mouseup listener
        document.addEventListener("mouseup", onMouseUp, false);
        document.addEventListener("touchend", onTouchEnd, false);
    };

    var onMouseDown = function (e) {
        // Ignore right-clicks
        if (e.button === 2) {
            return;
        }

        // Track click start time and position for click detection
        clickStartTime = Date.now();
        clickStartPos = { x: e.clientX, y: e.clientY };

        // Calculate relative position
        var rect = tile.getBoundingClientRect();
        var x = e.clientX - rect.left;
        var y = e.clientY - rect.top;

        applyTransform(x, y);
    };

    var onTouchStart = function (e) {
        if (e.touches.length > 0) {
            var rect = tile.getBoundingClientRect();
            var x = e.touches[0].clientX - rect.left;
            var y = e.touches[0].clientY - rect.top;

            applyTransform(x, y);
        }
    };

    var onMouseUp = function (e) {
        // Reset transform
        tile.style.webkitTransform = resetTransform;
        tile.style.MozTransform = resetTransform;
        tile.style.msTransform = resetTransform;
        tile.style.oTransform = resetTransform;
        tile.style.transform = resetTransform;

        document.removeEventListener("mouseup", onMouseUp, false);

        // Trigger click if it was a quick press (not a drag)
        var timeDiff = Date.now() - clickStartTime;
        var posDiff = Math.sqrt(
            Math.pow(e.clientX - clickStartPos.x, 2) +
            Math.pow(e.clientY - clickStartPos.y, 2)
        );

        if (timeDiff < 300 && posDiff < 10) {
            // This was a click, not a drag - let it propagate
            tile.click();
        }
    };

    var onTouchEnd = function (e) {
        // Reset transform
        tile.style.webkitTransform = resetTransform;
        tile.style.MozTransform = resetTransform;
        tile.style.msTransform = resetTransform;
        tile.style.oTransform = resetTransform;
        tile.style.transform = resetTransform;

        document.removeEventListener("touchend", onTouchEnd, false);
    };

    init();
}

// Initialize all tiles when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeTiles);
} else {
    initializeTiles();
}

function initializeTiles() {
    var tileElements = document.getElementsByClassName("tiles__tile");
    for (var i = 0; i < tileElements.length; i++) {
        new Tile(tileElements[i]);
    }
}

// Export for use in other scripts
if (typeof module !== 'undefined' && module.exports) {
    module.exports = Tile;
}
