$(document).ready(function () {
    Translate();
    $(".c-language").attr("src", "Vendor/img/flags/" + GetCurrentLanguage() + ".gif");
    buildAnimationSelector();
});

$(document).on("click", "[set-language]", function (e) {
    e.preventDefault();
    let lang = $(this).attr("set-language");
    localStorage.setItem('language', JSON.stringify(lang));
    $(".c-language").attr("src", "Vendor/img/flags/" + lang + ".gif");
    Translate();
});

$(document).on('click', '.custom-alert .close', function(e) {
    e.preventDefault();
    let element = $(this).parent();
    element.removeClass("animate__flipInX");
    element.addClass("animate__flipOutX");
    setTimeout(function () {
        element.remove();
    }, 600);
});

$(document).on('hide.bs.modal', '.custom-modal', function (e) {
    e.preventDefault();
    let modal = $(this),
        backdrop = $(document).find(".modal-backdrop");

    modal.removeClass("animate__bounceIn");
    modal.addClass("animate__bounceOut");
    $("body").removeClass("modal-open").removeAttr("style");
    $(backdrop[0]).fadeOut();
    setTimeout(function () {
        modal.remove();
        $(backdrop[0]).remove();
    }, 600)
});

function buildAnimationSelector() {
    let animations = {
        in: [
            'bounce', 'flash', 'pulse', 'rubberBand', 'shakeX', 'shakeY', 'headShake', 'swing', 'tada', 'wobble', 'jello',
            'heartBeat', 'backInDown', 'backInLeft', 'backInRight', 'backInUp', 'bounceIn', 'bounceInDown', 'bounceInLeft',
            'bounceInRight', 'bounceInUp', 'fadeIn', 'fadeInDown', 'fadeInDownBig', 'fadeInLeft', 'fadeInLeftBig',
            'fadeInRight', 'fadeInRightBig', 'fadeInUp', 'fadeInUpBig', 'fadeInTopLeft', 'fadeInTopRight',
            'fadeInBottomLeft', 'fadeInBottomRight', 'flipInX', 'flipInY', 'lightSpeedInRight', 'lightSpeedInLeft',
            'rotateInDownLeft', 'rotateInDownRight', 'rotateInUpLeft', 'rotateInUpRight', 'hinge', 'jackInTheBox',
            'rollIn', 'zoomIn', 'zoomInDown', 'zoomInLeft', 'zoomInRight', 'zoomInUp', 'slideInDown', 'slideInLeft',
            'slideInRight', 'slideInUp'
        ],
        out: [
            'backOutDown', 'backOutLeft', 'backOutRight', 'backOutUp', 'bounceOut', 'bounceOutDown', 'bounceOutLeft',
            'bounceOutRight', 'bounceOutUp', 'fadeOut', 'fadeOutDown', 'fadeOutDownBig', 'fadeOutLeft', 'fadeOutLeftBig',
            'fadeOutRight', 'fadeOutRightBig', 'fadeOutUp', 'fadeOutUpBig', 'fadeOutTopLeft', 'fadeOutTopRight',
            'fadeOutBottomRight', 'fadeOutBottomLeft', 'flipOutX', 'flipOutY', 'lightSpeedOutRight', 'lightSpeedOutLeft',
            'rotateOut', 'rotateOutDownLeft', 'rotateOutDownRight', 'rotateOutUpLeft', 'rotateOutUpRight', 'rollOut',
            'zoomOut', 'zoomOutDown', 'zoomOutLeft', 'zoomOutRight', 'zoomOutUp', 'slideOutDown', 'slideOutLeft',
            'slideOutRight', 'slideOutUp'
        ]
    };

    $.each($(document).find(".animation-selector"), function () {
        let dir = $(this).attr("data-dir");
        let me = $(this);
        me.html("");
        $.each(animations[dir], function (k, v) {
            me.append('<option value="' + v + '">' + v + '</option>');
        })
    })
}

function GenRANDstr(length) {
    let result = [],
        characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789',
        charactersLength = characters.length;
    for (let i = 0; i < length; i++) {
        result.push(characters.charAt(Math.floor(Math.random() * charactersLength)));
    }
    return result.join('');
}

function Translate(){
    $.getJSON("Autoload/translations.json", function(data){
        $.each($("[data-translate]"), function (k, v) {
            let language = !JSON.parse(localStorage.getItem('language')) ? "en" :
                            JSON.parse(localStorage.getItem('language'));
            if(data[$(this).attr("data-translate")])
                $(this).html(data[$(this).attr("data-translate")][language]);
        })
    }).fail(function(e){
        console.log("An error has occurred.");
    });
}

function ShowAlert(type, message, block = "#ErrorBlock") {
    let id = GenRANDstr(20),
        timeout = 15000;

    let html = '';
    html += '<div id="' + id + '" class="alert mb-0 alert-' + type + ' alert-dismissible custom-alert position-relative animate__animated" role="alert">';
    html += '   <div class="alert-overlay"></div>';
    html += '   <div class="d-flex align-items-center justify-content-between"></div>';
    html += '       <span class="mr-3">' + message + '</span>';
    html += '       <button type="button" class="close">';
    html += '           <span aria-hidden="true">&times;</span>';
    html += '       </button>';
    html += '   </div>';
    html += '</div>';

    let element = $(html),
        overlay = element.find(".alert-overlay");

    element.hide();
    element.addClass("animate__flipInX");

    $(document).find(block).append(element);
    Translate();
    element.show();
    overlay.animate({left: "-100%"}, timeout);
    setTimeout(function () {
        element.removeClass("animate__flipInX");
        element.addClass("animate__flipOutX");
        setTimeout(function () {
            element.remove();
        }, 600);
    }, timeout)
}

function ShowModal(size = "md", b_content = "", v_array = {}){
    let id = GenRANDstr(25),
        modal = $('<div class="modal custom-modal animate__animated" tabindex="-1" role="dialog" id="' + id + '"></div>'),
        dialog = $('<div class="modal-dialog modal-' + size + '" role="document"></div>'),
        content = $('<div class="modal-content"></div>'),
        body = $('<div class="modal-body mt-4">' + b_content + '</div>'),
        close = $('<button type="button" class="close modal-close" data-dismiss="modal" aria-label="Close"><span aria-hidden="true">&times;</span></button>');

    content.append(close);
    content.append(body);
    dialog.append(content);
    modal.append(dialog);

    $.each(v_array, function (k, v) {
        modal.attr('data-' + k, v);
    });

    $("body").append(modal);
    modal.addClass("animate__bounceIn");
    Translate();
    modal.modal("show");
}

function GetCurrentLanguage() {
    return !JSON.parse(localStorage.getItem('language')) ? "en" :
        JSON.parse(localStorage.getItem('language'));
}

let ajaxRequest = function (options) {
    let settings = $.extend({
            errorBlock: "#ErrorBlock",
            preload: false,
            preloadBlock: null,
            preloadMessage: "",
            params: {}
        }, options),
        preloadElement = null;

    let buildErrorAlert = function (type, message) {
        if(message.length === 0)
            return false;

        ShowAlert(type, message, settings.errorBlock);
    };

    this.ready = function(handleData){
        $.ajax({
            url: '/Engine/AjaxController.php',
            type: 'post',
            dataType: 'json',
            data: settings.params
        }).done(function(data) {
            buildErrorAlert(data.type, data.body);
            let state = data.success,
                result = data.recv;

            if(handleData)
                handleData({state, result, preloadElement});

        }).fail(function(err) {
            console.log(err.responseJSON ? err.responseJSON.message : err.responseText);
        })
    };
};