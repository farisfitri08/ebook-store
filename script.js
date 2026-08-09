// =========================
// BUY BUTTON
// =========================

const buyButton = document.querySelector("#buyButton");

buyButton.addEventListener("click", async function () {

    try {

        const response = await fetch(
            "/create-checkout-session",
            {
                method: "POST"
            }
        );

        const data = await response.json();

        window.location.href = data.url;

    } catch (error) {

        console.error(error);

        alert("Something went wrong.");

    }

});


// =========================
// FAQ
// =========================

const faqQuestions =
    document.querySelectorAll(".faq-question");


faqQuestions.forEach(function (question) {

    question.addEventListener("click", function () {

        const faqItem =
            question.parentElement;

        faqItem.classList.toggle("active");

    });

});