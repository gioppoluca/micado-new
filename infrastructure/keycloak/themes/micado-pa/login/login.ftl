<#import "template.ftl" as layout>
<@layout.registrationLayout displayMessage=!messagesPerField.existsError('username','password') displayInfo=false; section>
  <#if section = "header">
    <span class="pa-hidden-header">${msg("loginAccountTitle")}</span>
  <#elseif section = "form">
    <div class="pa-page">
      <aside class="pa-sidebar" aria-label="Application branding">
        <div class="pa-sidebar__top">
          <div class="pa-sidebar__title-row">
            <button class="pa-sidebar__menu" type="button" tabindex="-1" aria-hidden="true">☰</button>
            <span class="pa-sidebar__title">Micado App</span>
          </div>
        </div>

        <div class="pa-sidebar__brand">
          <img class="pa-sidebar__logo" src="${url.resourcesPath}/img/micado-logo.png" alt="Micado" />
        </div>
      </aside>

      <main class="pa-main">
        <div class="pa-login-wrap">
          <form id="kc-form-login" class="pa-form" action="${url.loginAction}" method="post">
            <div class="pa-field">
              <label class="pa-visually-hidden" for="username">
                <#if !realm.loginWithEmailAllowed>${msg("username")}
                <#elseif !realm.registrationEmailAsUsername>${msg("usernameOrEmail")}
                <#else>${msg("email")}</#if>
              </label>
              <input
                tabindex="1"
                id="username"
                class="pa-input"
                name="username"
                value="${(login.username!'')}"
                type="text"
                placeholder="example_username"
                autofocus
                autocomplete="username"
                aria-invalid="<#if messagesPerField.existsError('username','password')>true</#if>"
              />
            </div>

            <div class="pa-field">
              <label class="pa-visually-hidden" for="password">${msg("password")}</label>
              <input
                tabindex="2"
                id="password"
                class="pa-input"
                name="password"
                type="password"
                placeholder="***********"
                autocomplete="current-password"
                aria-invalid="<#if messagesPerField.existsError('username','password')>true</#if>"
              />
            </div>

            <#if messagesPerField.existsError('username','password')>
              <div class="pa-error" aria-live="polite">
                ${kcSanitize(messagesPerField.getFirstError('username','password'))?no_esc}
              </div>
            </#if>

            <#if realm.resetPasswordAllowed>
              <div class="pa-help">
                <a href="${url.loginResetCredentialsUrl}">forget password? contact admin</a>
              </div>
            </#if>

            <input type="hidden" id="id-hidden-input" name="credentialId" <#if auth.selectedCredential?has_content>value="${auth.selectedCredential}"</#if>/>

            <div class="pa-actions">
              <input tabindex="3" class="pa-submit" name="login" id="kc-login" type="submit" value="Login" />
            </div>
          </form>
        </div>
      </main>
    </div>
  </#if>
</@layout.registrationLayout>
