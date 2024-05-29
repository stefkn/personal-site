// Massive thanks to https://stackoverflow.com/users/5323516/manuel-otto for this script
// See https://stackoverflow.com/a/47206289 

/**
 * Smooth Scroll JS
 * new SmoothScroll(target,speed,smooth)
 */

function SmoothScroll(target, speed, smooth) {
    if (target === document)
        target =
            document.scrollingElement ||
            document.documentElement ||
            document.body.parentNode ||
            document.body; // cross browser support for document scrolling

    var moving = false;
    var pos = target.scrollTop;
    var frame =
        target === document.body && document.documentElement
            ? document.documentElement
            : target; // safari is the new IE

    target.addEventListener("mousewheel", scrolled, {
        passive: false,
    });
    target.addEventListener("DOMMouseScroll", scrolled, {
        passive: false,
    });
    document.addEventListener("click", handleMouseClick, {
        passive: false,
    });
    // document.addEventListener("scrollend", handleScrollEnd, {
    //     passive: false,
    //     capture: true,
    // });
    // document.addEventListener("scroll", handleScrollEnd, {
    //     passive: false,
    //     capture: true,
    // });

    // function handleScrollEnd(e) {
    //     console.log(e.type)
    //     // in Astro, the client side router listens for scrollend events to push new state to the history
    //     // we need to modify this behaviour to prevent thrashing of the browser history when using smooth scrolling
    //     // otherwise the browser can hang 
    //     // see https://github.com/withastro/astro/blob/5a48d5338529190dc9241b51cf490c1e4841e726/packages/astro/src/transitions/router.ts#L612
    //     // bug here https://issues.chromium.org/issues/40113103 
    //     e.preventDefault();
    // }

    function handleMouseClick(e) {
        // we need to check if we clicked on a URI fragment 
        // as smooth scrolling should be disabled in this case
        const target = e.target;
        if (target.tagName !== 'A') return;
        const href = target.getAttribute('href');
        if (!href || href[0] !== '#') return;
        // we have a URI fragment
        e.preventDefault();

        // get the target element
        const targetElement = document.getElementById(href.substring(1));
        if (!targetElement) return;

        // get the target position
        const targetPosition = targetElement.getBoundingClientRect().top + window.scrollY;
        pos = targetPosition;
        if (!moving) update();
    }

    function scrolled(e) {
        e.preventDefault(); // disable default scrolling

        var delta = normalizeWheelDelta(e);

        pos += -delta * speed;
        pos = Math.max(
            0,
            Math.min(
                pos,
                target.scrollHeight - frame.clientHeight,
            ),
        ); // limit scrolling

        if (!moving) update();
    }

    function normalizeWheelDelta(e) {
        if (e.detail) {
            if (e.wheelDelta)
                return (
                    (e.wheelDelta / e.detail / 40) *
                    (e.detail > 0 ? 1 : -1)
                );
            // Opera
            else return -e.detail / 3; // Firefox
        } else return e.wheelDelta / 120; // IE,Safari,Chrome
    }

    function update() {
        moving = true;
        var delta = (pos - target.scrollTop) / smooth;
        target.scrollTop += delta;
        if (Math.abs(delta) > 0.1) requestFrame(update);
        else moving = false;
    }

    var requestFrame = (function () {
        // requestAnimationFrame cross browser
        return (
            window.requestAnimationFrame ||
            window.webkitRequestAnimationFrame ||
            window.mozRequestAnimationFrame ||
            window.oRequestAnimationFrame ||
            window.msRequestAnimationFrame ||
            function (func) {
                window.setTimeout(func, 1000 / 50);
            }
        );
    })();
}

export default SmoothScroll;