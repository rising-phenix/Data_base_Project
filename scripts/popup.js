document.addEventListener("DOMContentLoaded", function () {
    const accepted = sessionStorage.getItem("termsAccepted");

    if (!accepted) {
        showConsentPopup();
    } else {
        VisitorTracker.start();
    }
});

function showConsentPopup() {
    const overlay = document.createElement("div");
    overlay.id = "consent-overlay";
    overlay.style.cssText = `
        position: fixed;
        inset: 0;
        background: rgba(0, 0, 0, 0.6);
        z-index: 9999;
        display: flex;
        align-items: center;
        justify-content: center;
    `;

    const box = document.createElement("div");
    box.style.cssText = `
        background: #fff;
        padding: 2.5rem;
        max-width: 420px;
        width: 90%;
        text-align: center;
        font-family: 'Playfair Display', serif;
    `;

    box.innerHTML = `
        <h2 style="margin-bottom: 1rem; font-size: 1.4rem;">Before You Continue</h2>
        <p style="margin-bottom: 1.5rem; font-size: 0.95rem; line-height: 1.6; color: #444;">
            By using this site, make sure you agree our terms and conditions.<br> Please read our <a href="termsandconditions.html" style="color: #000; font-weight: 700;">Terms and Conditions</a> for more details.
        </p>
        <button id="consent-agree" style="
            background: #000;
            color: #fff;
            border: none;
            padding: 0.7rem 2rem;
            font-size: 0.9rem;
            cursor: pointer;
            font-family: 'Playfair Display', serif;
            margin-right: 0.5rem;
        ">Agree</button>
        <button id="consent-decline" style="
            background: #fff;
            color: #000;
            border: 1px solid #000;
            padding: 0.7rem 2rem;
            font-size: 0.9rem;
            cursor: pointer;
            font-family: 'Playfair Display', serif;
        ">Decline</button>
    `;

    overlay.appendChild(box);
    document.body.appendChild(overlay);

    document.getElementById("consent-agree").addEventListener("click", function () {
        sessionStorage.setItem("termsAccepted", "true");
        if (window.VisitorTracker) {
            VisitorTracker.start();
        }
        overlay.remove();
    });

    document.getElementById("consent-decline").addEventListener("click", function () {
        window.location.href = "sorryaccessdeclined.html";
    });
}