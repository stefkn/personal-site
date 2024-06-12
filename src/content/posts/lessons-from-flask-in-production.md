---
title: 'Lessons from Flask in production'
pubDate: 2024-02-01
description: 'Thoughts from working on a monolithic Flask webapp for about five years.'
author: 'Stefan Nowak'
image: '../../assets/post_images/gradient_bg.jpg'
imageAlt: 'photo by Sean Sinclair on Unsplash'
tags: ["web", "python", "flask"]
featured: true
---


## Introduction

Anyone slightly interested in web development and software has probably heard of Django, one of the most popular web frameworks in the world. However, you may _not_ have heard of [Flask](https://flask.palletsprojects.com/en/3.0.x/), which is a more lightweight web framework for Python. It's roughly analagous to Django, but is smaller and leaves a lot more up to the end user – it self-identifies as a "microframework" which allows the user to integrate their own tools and libraries to best suit their use case. This means you need to choose your own ORM, templating language, authentication, etc., from the wider Flask ecosystem – which can be either a blessing or a curse.

I think Flask is a great framework, especially if you're looking for something lightweight and flexible, with a gentle learning curve. However, when using Flask in a production environment, I think there are a few things to be aware of, along with the [common Python footguns.](https://docs.python-guide.org/writing/gotchas/)

In this post I'll try to give some practical examples of issues I've seen working in large Flask codebases, and some tips on how to avoid them.

## Common pitfalls

### Chonky view functions

View functions are a big part of any Flask project. They're where you define the logic for handling requests and generating responses. However, there is often a temptation to throw a lot of business logic in these functions, as it's right where the request happens. Here's an example:

```python
# DISCLAIMER: All code appearing in this example are fictitious. Any resemblance to real production code, living or dead, is purely coincidental.

@login_required
@app.route('/account/settings/', methods=['GET', 'POST'])
def account_settings(customer_id):
    customer = Customer.query.get(customer_id)

    is_latest_order_shipped = Customer.query.filter_by(customer_id=customer_id).order_by(Order.date.desc()).first().shipped

    is_currently_subscribed = Subscription.query.filter_by(customer_id=customer_id).first().active

    # lots of other database queries and data processing here...

    if request.method == 'POST':
        is_valid, valid_address = AddressValidationService().validate_address(
            request.form['address']
        ) 
        if is_valid: 
            crm_service = CRMService()
            customer.address = valid_address
            crm_service.update_customer_address(
                customer_id, valid_address
            )
            crm_service.notify_customer_updated(
                customer_id, valid_address
            )

        # lots more POST-handling, form data processing and business logic here...

        customer.save()
        logger.info(
            f'Customer {customer_id} updated their settings', 
            extra={'customer_id': customer_id}
        )
        CustomerNotifyService().notify_customer(
            customer_id, 'Your settings have been updated!'
        )
        flash('Settings saved!')

    context = {
        'customer': customer, 
        'is_latest_order_shipped': is_latest_order_shipped, 
        'is_currently_subscribed': is_currently_subscribed
    }
    return render_template('account_settings.html', context)
```

What is going on here!? This view function is doing way too much. It's querying the database multiple times, processing data, handling form submissions, updating the customer's settings, sending notifications, logging, and rendering a template. It's hard to read, reason about, test, monitor and maintain. Could this be more like:

```python
@login_required
@app.route('/account/settings/', methods=['GET', 'POST'])
def account_settings(customer_id):
    customer = Customer.query.get(customer_id)

    if request.method == 'POST':
        flash_message = handle_post_request(
            customer_id, request.form
        )
        flash(flash_message)

    context = {
        'customer': customer, 
        'is_latest_order_shipped': customer.is_latest_order_shipped, 
        'is_currently_subscribed': customer.is_currently_subscribed
    }
    return render_template('account_settings.html', context)
```

This is much better! We've moved the business logic into a separate function, which makes the view function much cleaner and easier to read. We've also moved the database queries into the model, which makes the code more modular and easier to test. We could even move POST-handling into a separate view, to make it even cleaner.

View functions should be thin and focused on handling requests and generating responses, not on business logic.

### Mutation on GET

Flask doesn't enforce any rules about what you can and can't do in a view function, so you're free to do anything–including breaking the HTTP specification. Here's what MDN says about Safe Methods:

> **An HTTP method is safe if it doesn't alter the state of the server.** In other words, a method is safe if it leads to a read-only operation. Several common HTTP methods are safe: GET, HEAD, or OPTIONS. All safe methods are also idempotent, but not all idempotent methods are safe. For example, PUT and DELETE are both idempotent but unsafe.
> [MDN Developer Docs](https://arc.net/l/quote/slfskdwp)

So, if you somehow end up mutating state on a GET request, such as by writing data to the DB, you're breaking GET's [idempotency](https://httpwg.org/specs/rfc9110.html#idempotent.methods). This can lead to all sorts of problems, including security vulnerabilities and crazy unexpected behaviour. Like this:

```python
# DISCLAIMER: All code appearing in this example are fictitious. Any resemblance to real production code, living or dead, is purely coincidental.

@app.route('/signup/', methods=['GET'])
def signup_start(customer_id=None):
    # do some stuff...

    if not customer_id:
        country = _get_current_country()
        customer_id = _create_new_customer(country) # please no :(

    if request.method == 'POST':
        # do some form handling
        return redirect(
            url_for(
                'signup_step_1', 
                customer_id=customer_id
            )
        )

    return render_template('signup_start.html')

@app.route('/some-cool-view/', methods=['GET'])
def some_unrelated_view_function(customer_id=None):
    # do some stuff...

    if not customer_id:
        return redirect(
            url_for('signup_start')
        )

    return render_template('some_cool_template.html')
```

For example, in the above code, we've got a signup flow which creates a new Customer model instance when it encounters a request without a `customer_id`, and we have other views that redirect to this view if they don't have a `customer_id`. Not only is this a bad idea purely due to the HTTP spec being broken, but it's especially bad if other parts of the code will redirect to this one without knowing that it will create a new customer. This can lead to all sorts of unexpected behaviour and bugs.

For example if, for some reason, your session is lost between the first request and the second, you'll end up with a new customer every time you hit the second view, and enter into an infinite loop of creating new customers. Yikes!

### Observability, monitoring and logging

Flask doesn't come with specific built-in support for observability, monitoring, or logging. This means you have to implement these features yourself. It's a great idea to use a package like [structlog](https://www.structlog.org/en/stable/) or, if you decide to use Python's built-in logging module, to set up a **consistent logging strategy**.

On a large enough project, with many developers, logging can become a bit of an afterthought. Without a consistent logging strategy, you can end up with a situation like this:

```python
# DISCLAIMER: All code appearing in this example are fictitious. Any resemblance to real production code, living or dead, is purely coincidental.

# function a
logger.info(f'Customer {customer_id} updated their settings')

# function b 
logger.info(f'settings updated', customer_id=customer_id)

# function c
logger.info(
    event=SETTINGS_UPDATE, 
    customer_id=customer_id, 
    old_data=old_customer_data,
    data=customer_data
)

# function d
logger.info("new address added for " + str(customer_id))

# ... and so on
```

Enforcing a consistent logging strategy means using the same log levels, the same log format, and the same log destinations across your entire codebase. This makes it easier to read, search, and filter logs, which is especially important when you're trying to debug an issue in production.

For monitoring, third party tools such as [Sentry](https://sentry.io/) are excellent for dealing with runtime exceptions. I can also confidently recommend [DataDog](https://www.datadoghq.com/), which is a powerful tool for monitoring and observability, but can be expensive and has a massive feature-set that includes [Real-time User Monitoring](https://www.datadoghq.com/product/real-user-monitoring/) for frontend SPAs.

If you're running a complex system of multiple apps and microservices, it may be a good idea to look into implementing [OpenTelemetry](https://opentelemetry.io/docs/what-is-opentelemetry/) across the stack, and using tools that integrate with it like [Jaeger](https://www.jaegertracing.io/) for distributed tracing and [Prometheus](https://prometheus.io/) for metrics.

### Slow calls in views

Flask is single-threaded by default, which means that long-running function calls in your view functions can (and will) block other requests from being processed. This can lead to poor performance and a bad UX.

```python
# DISCLAIMER: All code appearing in this example are fictitious. Any resemblance to real production code, living or dead, is purely coincidental.

@app.route('/some-endpoint/', methods=['GET'])
def some_endpoint(customer_id):
    # do some stuff...
    stuff = get_stuff_from_db(customer_id)
    result = ExternalAPIAdapter().get_thiings_for_stuff(stuff)
    return prepare_response(result)
```

In this example, we're going to block the current request while the external API call is being made. If there's no sensible timeout and a number of retries happen automatically, this could block this request indefinitely–until uWSGI or Gunicorn decides to finally kill it.

Not only can this lead to poor UX in production, where a problematic external system can cause serious issues in your app; it can cause frustration in local dev environments where networking issues are more common and it can be tricky to debug while it eats up Flask process threads.

### ORM usage patterns

Flask doesn't come with an ORM out of the box, so you have to choose one yourself. SQLAlchemy is a popular choice, but it can be tricky to use correctly and efficiently. There are extensive guides on how to optimise SQL queries, but it's easy to get wrong, especially when working with complicated ORM queries that abstract away the underlying SQL.

One common pitfall is the N+1 query problem. This is where you end up making multiple successive queries to the database when you could have done it in one. For example:

```python
# DISCLAIMER: All code appearing in this example are fictitious. Any resemblance to real production code, living or dead, is purely coincidental.

@app.route('/some-endpoint/', methods=['GET'])
def some_endpoint(customer_id):
    customers = session.query(Customer).all().filter_by(
        Customer.active == True, 
        Customer.country == Countries.UNITED_STATES
    )
    orders = session.query(Order).any(
        Order.customer_id.in_([c.id for c in customers])
    ).all()
    return render_template(
        'some_template.html', 
        customers=customers, 
        orders=orders
    )
```

In this example, we're making two separate queries to the database: one to get the set of customers and another one to get their orders. This is inefficient and can lead to performance problems, especially when dealing with a large dataset and more complex queries. Instead, you can use a join to get all the data you need in one query:

```python
@app.route('/some-endpoint/', methods=['GET'])
def some_endpoint(customer_id):
    customers_orders = session.query(Customer).join(Customer.order).filter(
        Customer.active == True, 
        Customer.country == Countries.UNITED_STATES
    ).all()
    return render_template(
        'some_template.html', 
        customers_orders=customers_orders,
    )
```

This is more efficient, as it only makes one query to the database. I would argue it's a bit easier to follow the logic as well, as you're not jumping between different queries to understand what's going on, but `JOIN`s can be complicated, especially when chained together, so it's not universally better. Sometimes it might be a worthwhile tradeoff to use a less efficient query for the sake of readability and maintainability.

Another common pitfall is the of the [`session` object](https://docs.sqlalchemy.org/en/20/orm/session_basics.html), and the SQLAlchemy Unit of Work pattern. The session object will track changes to ORM objects in the current thread and will commit them to the database when you call `session.commit()`. A problem can arise (speaking from experience) when some parts of the codebase are making temporary changes that are not intended to be persisted to the database, but then another part of the codebase calls `session.commit()` and those changes are persisted anyway.

This can lead to some real head-(aches/scratchers/bangers) (please delete as appropriate).

### Jinja2 macro rabbit holes

Jinja2 macros are a powerful feature of Flask, but they can be a bit of a double-edged sword. It's easy to get carried away with macros and end up with a tangled mess of code that's hard to maintain–especially if you're using them to generate complex HTML structures or handle a lot of logic. Imagine if each of the macros used below was a separate file about 200 lines long, and each one uses a few more macros–it's macros all the way down!

```html
<!-- DISCLAIMER: All code appearing in this example are fictitious. Any resemblance to real production code, living or dead, is purely coincidental. -->

{% macro render_customer(customer) %}
    <div class="customer">
        {{ render_customer_details(customer, store) }}
        {% if current_user.is_order_admin %}
            {{ render_customer_orders_detail(customer, orders) }}
        {% endif %}
        {% if customer.orders %}
            <ul>
                {% for order in customer.orders %}
                    {% if current_user.is_order_admin %}
                        {% if order.country in ['GB', 'FR'] %}
                            {% if order.destination == PICKUP_POINT %}
                                {{ render_eu_order_details_pickup_point(order, courier, pickup_locations) }}
                            {% else %}
                                {{ render_non_eu_order_details_and_courier(order, courier) }}
                            {% endif %}
                        {% else %}
                            {{ render_non_eu_order_details_and_courier(order, courier) }}
                        {% endif %}
                        {% if order.status in [ORDER_CANCEL, ORDER_HOLD] %}
                            {{ render_order_stalled_details(order, order.status, courier) }}
                        {% else %}
                            {{ render_order_normal_status(order) }}
                        {% endif %}
                    {% else %}
                        {{ render_generic_order_details(order), customer }}
                    {% endif %}
                {% endfor %}
            </ul>
        {% else %}
            <p>No orders yet</p>
        {% endif %}
    </div>
{% endmacro %}
```

I can barely even read it! Try to use macros carefully, avoid too much nesting and conditional logic, avoid making them too long and complex, name them sensibly, and keep them focused on one or two specific responsibilities.

### Excessive logic in templates

Jinja2 allows you to do a lot of logic in your templates, but just because you can doesn't mean you should. It's easy to end up with complex, hard-to-read templates that are full of business logic and data processing. This can make your code harder to maintain and debug, and can lead to performance problems if you're doing a lot of processing in your templates.

```html
<!-- DISCLAIMER: All code appearing in this example are fictitious. Any resemblance to real production code, living or dead, is purely coincidental. -->

{% if delivery.is_paid %}
    {% if delivery.price %}
        {% if payment_method %}
            {% if payment_method == 'visa' %}
                <p>Payment of {{ price | money(locale=locale) }} received on {{ payment_date | date('medium') }} from Visa card.</p>

            {% elif payment_method == 'mastercard' %}
                <p>Payment of {{ price | money(locale=locale) }} received on {{ payment_date | date('medium') }} from PayPal.</p>

            {% elif payment_method == 'klarna' %}
                {% set klarna_payment_status = KlarnaService().get_payment_status(delivery.payment_id) %}
                {% set klarna_payment_instalment = KlarnaService().get_instalments(delivery.payment_id) %}

                {% if klarna_payment_status == 'completed' %}
                    <p>Payment of {{ price | money(locale=locale) }} received on {{ payment_date | date('medium') }} from Klarna.</p>
                {% else %}
                    <p>Payment of {{ price | money(locale=locale) }} is on instalment {{ KlarnaService.get_max_instalments(customer) - klarna_payment_instalment }}</p>
                {% endif %}

            {% elif payment_method == 'paypal' %}
                <p>Payment of {{ price | money(locale=locale) }} received on {{ payment_date | date('medium') }} from PayPal.</p>

            {% elif payment_method == 'stripe' %}
                {% if is_payment_completed %}
                    <p>Payment of {{ price | money(locale=locale) }} received on {{ payment_date | date('medium') }} from Stripe.</p>

                {% else %}
                    <p>Payment of {{ price | money(locale=locale) }} is pending from Stripe.</p>

                {% endif %}
            {% endif %}

        {% else %}
            <p>Payment received.</p>
        {% endif %}
    {% endif %}
{% elif delivery.has_message %}
    ...
{% elif delivery.is_delayed %}
    ...
{% elif delivery.is_failed %}
    ...
```

This is a bit of a contrived example, but you get the idea–_there's so much view logic happening in the template,_ and this isn't rare! It would make more sense to create a function that encapsulates this logic, and handles the slight differences between payment provider systems, and call that function in the view or the template.

### Storing large data structures in templates (!?!)

I wish I could say I've never seen this, but I have.

```html
<!-- DISCLAIMER: All code appearing in this example are fictitious. Any resemblance to real production code, living or dead, is purely coincidental. -->

{% macro pick_up_points(order, is_future_shipment, is_current) %}
    {% set pick_up_points = [
        ('Pickup Point 1', '123 Fake Street, London, UK', '9am-5pm', False, 11),
        ('Pickup Point 2', '123 Fake Street, London, UK', '9am-5pm', True, 12),
    ... for 96 more rows %}

    {% for point in pick_up_points %}
    ...
```

_Please no, please stop, it hurts my soul._ If you need to store data like this, use a JSON file, a database, or a config file. Anything but in a template. _Anything!_

### i18n headaches

Flask has built-in support for internationalisation (i18n) and localisation (l10n) using the [`gettext` module](https://www.gnu.org/software/gettext/) and [`jinja2.ext.i18n`](https://tedboy.github.io/jinja2/ext2.html) and there are also great libraries like [flask-babel](https://python-babel.github.io/flask-babel/), but there are some things to be aware of. If your deployment pipeline depends on a translations `compile -> upload -> download -> build -> deploy` process, you might end up with broken or missing translations on prod, or just a blocked deployment pipeline. This can be especially painful if you're working with a large team, or if you're working with a lot of translations.

It's also easy to forget to mark strings for translation, or to miss a translation when you're adding new strings to your code. You can set up linting rules to catch things like this in CI or even in pre-commit hooks. One handy thing to know is how to tell Jinja to strip whitespace from strings:

```html
{%- trans -%}
   Some translated text, but with white space stripped by Jinja
{%- endtrans -%}
```

This is because with some translation systems, whitespace that is often snuck in by local IDEs and linters can cause all kind of trouble. Other weird unicode characters can also cause issues, so it's a good idea to use a linter to catch these issues before they make it to prod.

### Non-standardised error handling

Flask doesn't enforce any rules about how you should handle errors in your code. This means it's easy to end up with inconsistent error handling across your app, which can make it hard to debug and maintain. For instance, you might have slightly differing interpretations of what a 404 error means, or what a 500 error means, or what a 403 error means.

The format of the error message, the status code, and the response headers can all vary from one view to another, and the third-party services you're logging and reporting to might be used differently across the app–such as some views sending expected 3rd party API errors to Sentry, and others not.

An example might be using `abort(404)` in one view, and `raise NotFound` in another, and `return jsonify({'error': 'Not found'}), 404` in another.

It's a good idea to have a consistent approach to error handling, and to use a package like [flask-restful](https://flask-restful.readthedocs.io/en/latest/) or [flask-restplus](https://flask-restplus.readthedocs.io/en/latest/) to handle errors in a consistent way.

For example, you could use a custom error handler to catch all exceptions and return a JSON response with a standard error message and status code:

```python
@app.errorhandler(Exception)
def handle_exception(e):
    sentry_exception_id = sentry.capture_exception()
    error_context = {
        'error': str(e),
        'sentry_id': sentry_exception_id
    }
    structlog.get_logger().error(
        error_context
    )
    return jsonify({
        error_context
    }), 500
```

### Batteries not included

Because Flask is a microframework, you get to choose all of the batteries you want to include. In some ways this is great; you can specify exactly what you need and don't need, compared to a more full-stack framework like Django where you get a lot of stuff built-in by default, that you might not actually need.

One drawback of this, however, is that you now need to make sure you're updating all of your dependencies, especially if you're using mission-critical packages like [flask-login](https://flask-login.readthedocs.io/en/latest/) or [flask-wtf](https://flask-wtf.readthedocs.io/en/latest/). Rather than just making sure to update the framework version, you need to keep an eye on all of the packages you're using, and make sure they're all up-to-date and secure, or you might end up finding that you're running a package inproduction that has't been updated since 2012. Yikes! This isn't specifically a Flask problem, but it's something to be aware of when using a microframework.

<div style="margin-top: 4rem;"></div>

---
---

<div style="margin-top: 2rem;">
Photo by <a href="https://unsplash.com/@seanwsinclair?utm_content=creditCopyText&utm_medium=referral&utm_source=unsplash">Sean Sinclair</a> on <a href="https://unsplash.com/photos/a-blurry-image-of-a-rainbow-colored-background-C_NJKfnTR5A?utm_content=creditCopyText&utm_medium=referral&utm_source=unsplash">Unsplash</a>
</div>